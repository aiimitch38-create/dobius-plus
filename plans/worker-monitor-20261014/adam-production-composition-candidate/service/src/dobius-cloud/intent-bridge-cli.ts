import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { performance } from 'node:perf_hooks'
import { z } from 'zod'
import { AdamCloudIntentEnvelope, AdamCloudSealedEnvelope } from './intent-contract.js'
import { ApprovedJobPayload } from './approved-job-payload.js'
import {
  canonicalCloudJobAdamJson, canonicalCloudJobAdamSha256, CloudJobAdamBindingIdentity
} from './receipt-contract.js'
import type { TrustedApprovedCloudDecision } from './approved-decision-contract.js'
import type { DurableApprovedIntentSubmission } from './receipt-store.js'

const Uuid = z.string().uuid()
const CloudId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/)
const MAX_INPUT_BYTES = 128 * 1024
const MAX_OUTPUT_BYTES = 64 * 1024
const MAX_CALL_MS = 15_000
const MAX_AUTHORITY_WAIT_MS = 5_000
const REMOTE_SELECTORS = ['DOBIUS_PAIRING_CODE', 'DOBIUS_REMOTE_PAIRING', 'DOBIUS_ENVIRONMENT']
const ChildStates = new Set('queued waiting_for_worker running needs_review completed failed cancelled interrupted'.split(' '))

export const IntentBridgeCredential = z.object({
  schemaVersion: z.literal(1),
  audienceRuntimeId: Uuid,
  credential: z.string().regex(/^[A-Za-z0-9_-]{43}$/).refine((value) => {
    const bytes = Buffer.from(value, 'base64url')
    return bytes.byteLength === 32 && bytes.toString('base64url') === value
  }),
  runtimeUserDataPath: z.string().min(1).max(4096),
  authorizationGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
}).strict()
export type IntentBridgeCredential = z.infer<typeof IntentBridgeCredential>

export interface IntentBridgeCredentialAuthority {
  acquire(signal: AbortSignal): Promise<unknown | null>
  isCurrent(credential: IntentBridgeCredential): boolean
}

export type ApprovedIntentChild = {
  id: string
  state: string
  projectId: string
  requestKey: string
  taskId: string
  workspaceId: string
  sourceRevision: string
  targetDeviceId: string
  recipeId: string
}

export type IntentBridgeCall = (executablePath: string, args: string[], body: string,
  credential: IntentBridgeCredential, signal: AbortSignal) => Promise<unknown>

export class DobiusApprovedIntentCli {
  constructor(
    private readonly executablePath: string,
    private readonly authority: IntentBridgeCredentialAuthority,
    private readonly invoke: IntentBridgeCall = runBoundedCli
  ) {
    if (!isAbsolute(executablePath) || executablePath.length > 4096) throw new Error('intent bridge unavailable')
  }

  async seal(
    envelopeRaw: unknown,
    decision: TrustedApprovedCloudDecision,
    assertDecisionCurrent: () => void = () => undefined
  ): Promise<string> {
    const envelope = AdamCloudIntentEnvelope.parse(envelopeRaw)
    if (envelope.identity.projectId !== decision.projectId ||
        envelope.identity.parentObjectiveId !== decision.parentObjectiveId ||
        envelope.identity.parentObjectiveVersion !== decision.parentObjectiveVersion ||
        envelope.identity.contextDigest !== decision.contextDigest ||
        envelope.identity.expiresAtMs > decision.expiresAtMs) throw new Error('intent bridge unavailable')
    const session = await this.acquire()
    assertDecisionCurrent()
    assertCurrent(this.authority, session)
    const body = JSON.stringify({ schemaVersion: 1, audienceRuntimeId: session.audienceRuntimeId,
      credential: session.credential, envelope })
    const response = await this.invoke(this.executablePath,
      ['seal-adam-intent', '--request-stdin', '--json'], body, session, new AbortController().signal)
    assertDecisionCurrent()
    assertCurrent(this.authority, session)
    const result = z.object({ schemaVersion: z.literal(1), audienceRuntimeId: Uuid,
      intentId: Uuid, identity: CloudJobAdamBindingIdentity, sealedEnvelope: AdamCloudSealedEnvelope }).strict()
      .safeParse(parseCliResult(response, session.audienceRuntimeId))
    if (!result.success || result.data.audienceRuntimeId !== session.audienceRuntimeId ||
        result.data.intentId !== envelope.intentId ||
        canonicalCloudJobAdamJson(result.data.identity) !== canonicalCloudJobAdamJson(envelope.identity)) {
      throw new Error('intent bridge unavailable')
    }
    return result.data.sealedEnvelope
  }

  async submit(
    dto: DurableApprovedIntentSubmission,
    decision: TrustedApprovedCloudDecision,
    assertDecisionCurrent: () => void = () => undefined
  ): Promise<ApprovedIntentChild> {
    const identity = CloudJobAdamBindingIdentity.parse(dto.identity)
    const approvedJob = ApprovedJobPayload.parse(dto.approvedJob)
    if (dto.schemaVersion !== 1 || !Uuid.safeParse(dto.intentId).success || identity.projectId !== decision.projectId ||
        identity.parentObjectiveId !== decision.parentObjectiveId ||
        identity.parentObjectiveVersion !== decision.parentObjectiveVersion ||
        identity.contextDigest !== decision.contextDigest || approvedJob.projectId !== identity.projectId ||
        identity.requestFingerprint !== canonicalCloudJobAdamSha256(approvedJob)) {
      throw new Error('intent bridge unavailable')
    }
    const session = await this.acquire()
    assertDecisionCurrent()
    assertCurrent(this.authority, session)
    const request = {
      schemaVersion: 1,
      audienceRuntimeId: session.audienceRuntimeId,
      credential: session.credential,
      intentId: dto.intentId,
      identity,
      sealedEnvelope: AdamCloudSealedEnvelope.parse(dto.sealedEnvelope),
      approvedJob
    }
    const response = await this.invoke(this.executablePath, ['submit-adam-child', '--request-stdin', '--json'],
      JSON.stringify(request), session, new AbortController().signal)
    assertDecisionCurrent()
    assertCurrent(this.authority, session)
    const result = z.object({ schemaVersion: z.literal(1), audienceRuntimeId: Uuid,
      intentId: Uuid, identity: CloudJobAdamBindingIdentity, job: z.unknown() }).strict()
      .safeParse(parseCliResult(response, session.audienceRuntimeId))
    if (!result.success || result.data.intentId !== dto.intentId ||
        result.data.audienceRuntimeId !== session.audienceRuntimeId ||
        canonicalCloudJobAdamJson(result.data.identity) !== canonicalCloudJobAdamJson(identity)) {
      throw new Error('intent bridge unavailable')
    }
    return parseChild(result.data.job, approvedJob)
  }

  private async acquire(): Promise<IntentBridgeCredential> {
    const abort = new AbortController()
    try {
      let timeout: NodeJS.Timeout | undefined
      const raw = await Promise.race([
        this.authority.acquire(abort.signal),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => { abort.abort(); reject(new Error('deadline')) }, MAX_AUTHORITY_WAIT_MS)
          timeout.unref()
        })
      ]).finally(() => { if (timeout) clearTimeout(timeout) })
      const parsed = IntentBridgeCredential.safeParse(raw)
      if (!parsed.success || !isAbsolute(parsed.data.runtimeUserDataPath)) throw new Error('unavailable')
      return parsed.data
    } catch {
      throw new Error('intent bridge unavailable')
    }
  }
}

function assertCurrent(authority: IntentBridgeCredentialAuthority, credential: IntentBridgeCredential): void {
  try {
    if (!authority.isCurrent(credential)) throw new Error('stale')
  } catch {
    throw new Error('intent bridge unavailable')
  }
}

function parseCliResult(raw: unknown, runtimeId: string): Record<string, unknown> {
  const response = z.object({
    ok: z.literal(true),
    _meta: z.object({ runtimeId: Uuid }).strict(),
    result: z.record(z.string(), z.unknown())
  }).strict().safeParse(raw)
  if (!response.success || response.data._meta.runtimeId !== runtimeId) throw new Error('intent bridge unavailable')
  return response.data.result
}

function parseChild(raw: unknown, expected: z.infer<typeof ApprovedJobPayload>): ApprovedIntentChild {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('intent bridge unavailable')
  const job = raw as Record<string, unknown>
  const id = CloudId.safeParse(job.id)
  if (!id.success || typeof job.state !== 'string' || !ChildStates.has(job.state) ||
      job.projectId !== expected.projectId || job.requestKey !== expected.requestKey || job.taskId !== expected.taskId ||
      job.workspaceId !== expected.workspaceId || job.sourceRevision !== expected.sourceRevision ||
      job.targetDeviceId !== expected.targetDeviceId || job.recipeId !== expected.recipeId) {
    throw new Error('intent bridge unavailable')
  }
  return { id: id.data, state: job.state, projectId: expected.projectId, requestKey: expected.requestKey,
    taskId: expected.taskId, workspaceId: expected.workspaceId, sourceRevision: expected.sourceRevision,
    targetDeviceId: expected.targetDeviceId, recipeId: expected.recipeId }
}

function runBoundedCli(executablePath: string, args: string[], body: string, credential: IntentBridgeCredential,
  signal: AbortSignal): Promise<unknown> {
  const input = Buffer.from(body, 'utf8')
  if (!isAbsolute(executablePath) || input.length > MAX_INPUT_BYTES) return Promise.reject(new Error('intent bridge unavailable'))
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams
    try {
      const env: NodeJS.ProcessEnv = {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        LANG: process.env.LANG,
        DOBIUS_USER_DATA_PATH: credential.runtimeUserDataPath
      }
      for (const name of REMOTE_SELECTORS) delete env[name]
      child = spawn(executablePath, args, {
        cwd: credential.runtimeUserDataPath, env, shell: false, windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      }) as ChildProcessWithoutNullStreams
    } catch { reject(new Error('intent bridge unavailable')); return }
    const output: Buffer[] = []
    let bytes = 0
    let settled = false
    let closed = false
    const deadline = performance.now() + MAX_CALL_MS
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(new Error('intent bridge unavailable'))
      else resolve(value)
    }
    const stop = () => {
      try { child.kill('SIGKILL') } catch {}
      finish(new Error('intent bridge unavailable'))
    }
    const timer = setTimeout(stop, MAX_CALL_MS)
    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      bytes += buffer.length
      if (bytes > MAX_OUTPUT_BYTES) { stop(); return }
      output.push(buffer)
    }
    const onClose = (code: number | null) => {
      closed = true
      clearTimeout(timer)
      signal.removeEventListener('abort', stop)
      if (settled) return
      if (code !== 0 || performance.now() >= deadline) { finish(new Error('failed')); return }
      try { finish(undefined, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(output)))) }
      catch { finish(new Error('invalid response')) }
    }
    signal.addEventListener('abort', stop, { once: true })
    child.stdout.on('data', onData)
    child.stderr.on('data', (chunk) => { bytes += Buffer.byteLength(chunk); if (bytes > MAX_OUTPUT_BYTES) stop() })
    child.on('error', () => finish(new Error('spawn failed')))
    child.on('close', onClose)
    child.stdin.on('error', () => { if (!closed) stop() })
    child.stdin.end(input)
  })
}
