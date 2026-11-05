import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { z } from 'zod'
import {
  AdamCloudChildSubmitError,
  type AdamCloudChild,
  type AdamCloudChildSubmitFailure,
  type AdamCloudJobInput,
  type AdamCloudSubmissionProof
} from './child-submit-contract.js'

const CloudId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/)
const CHILD_STATES = new Set('queued waiting_for_worker running needs_review completed failed cancelled interrupted'.split(' '))
const MAX_WIRE_BYTES = 64 * 1024
const MAX_OUTPUT_BYTES = 64 * 1024
const REMOTE_SELECTOR_ENV = ['DOBIUS_PAIRING_CODE', 'DOBIUS_REMOTE_PAIRING', 'DOBIUS_ENVIRONMENT']

export type ChildSubmitProcessOptions = {
  executablePath: string
  deadlineAt: number
  assertProofCurrent: () => void
  spawnProcess?: typeof spawn
}

export function remainingSubmitMs(deadlineAt: number): number {
  const remaining = deadlineAt - performance.now()
  if (remaining <= 0) throw new AdamCloudChildSubmitError('deadline')
  return remaining
}

export function runLocalChildSubmit(
  request: { input: AdamCloudJobInput; grant: unknown },
  proof: AdamCloudSubmissionProof,
  options: ChildSubmitProcessOptions
): Promise<AdamCloudChild> {
  const envelope = Buffer.from(JSON.stringify({ schemaVersion: 1, ...request }), 'utf8')
  if (envelope.byteLength > MAX_WIRE_BYTES) throw new AdamCloudChildSubmitError('invalid-request')

  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams
    try {
      const env: NodeJS.ProcessEnv = { ...process.env, DOBIUS_USER_DATA_PATH: proof.runtimeUserDataPath }
      for (const name of REMOTE_SELECTOR_ENV) delete env[name]
      remainingSubmitMs(options.deadlineAt)
      options.assertProofCurrent()
      child = (options.spawnProcess ?? spawn)(
        options.executablePath,
        ['submit-adam-child', '--request-stdin', '--json'],
        { cwd: proof.runtimeUserDataPath, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
      ) as ChildProcessWithoutNullStreams
    } catch (error) {
      reject(error instanceof AdamCloudChildSubmitError ? error : new AdamCloudChildSubmitError('spawn-failed'))
      return
    }

    const stdout: Buffer[] = []
    let outputBytes = 0
    let terminal = false
    let settled = false
    let closed = false
    const timer = setTimeout(() => stop('deadline'), Math.max(0, options.deadlineAt - performance.now()))
    const settle = (error?: AdamCloudChildSubmitError, value?: AdamCloudChild) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else if (value) resolve(value)
      else reject(new AdamCloudChildSubmitError('invalid-response'))
    }
    const cleanupAtClose = () => {
      clearTimeout(timer)
      child.stdout.off('data', onStdout)
      child.stderr.off('data', onStderr)
      child.stdout.off('error', onOutputError)
      child.stderr.off('error', onOutputError)
      child.stdin.off('error', onStdinError)
      child.off('error', onChildError)
      child.off('close', onClose)
      stdout.length = 0
    }
    const stop = (code: AdamCloudChildSubmitFailure) => {
      if (terminal) return
      terminal = true // Set before kill: it can synchronously emit a child error.
      settle(new AdamCloudChildSubmitError(code))
      try { child.kill('SIGKILL') } catch { /* Keep the finite typed failure. */ }
      // Error sinks stay attached; stdout/stderr handlers discard until actual close.
    }
    const onOutputError = () => { if (!terminal) stop('child-failed') }
    const onStdinError = () => { if (!terminal) stop('child-failed') }
    const onChildError = () => { if (!terminal) stop('spawn-failed') }
    const countOutput = (chunk: Buffer | string, isStdout: boolean) => {
      if (terminal) return
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      outputBytes += bytes.byteLength
      if (outputBytes > MAX_OUTPUT_BYTES) { stop('output-limit'); return }
      if (isStdout) stdout.push(bytes)
    }
    const onStdout = (chunk: Buffer | string) => countOutput(chunk, true)
    const onStderr = (chunk: Buffer | string) => countOutput(chunk, false)
    const onClose = (code: number | null) => {
      if (closed) return
      closed = true
      if (!terminal) {
        terminal = true
        try {
          if (performance.now() >= options.deadlineAt) throw new AdamCloudChildSubmitError('deadline')
          if (code !== 0) throw new AdamCloudChildSubmitError('child-failed')
          const response = parseChildResponse(Buffer.concat(stdout), proof, request.input)
          remainingSubmitMs(options.deadlineAt)
          options.assertProofCurrent()
          settle(undefined, response)
        } catch (error) {
          settle(error instanceof AdamCloudChildSubmitError ? error : new AdamCloudChildSubmitError('invalid-response'))
        }
      }
      cleanupAtClose()
    }

    child.stdout.on('data', onStdout)
    child.stderr.on('data', onStderr)
    child.stdout.on('error', onOutputError)
    child.stderr.on('error', onOutputError)
    child.stdin.on('error', onStdinError)
    child.on('error', onChildError)
    child.on('close', onClose)
    try {
      options.assertProofCurrent()
      remainingSubmitMs(options.deadlineAt)
      child.stdin.end(envelope)
    } catch (error) {
      stop(error instanceof AdamCloudChildSubmitError ? error.code : 'not-ready')
    }
  })
}

function parseChildResponse(bytes: Buffer, proof: AdamCloudSubmissionProof, input: AdamCloudJobInput): AdamCloudChild {
  const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid')
  const envelope = raw as Record<string, unknown>
  if (envelope.ok !== true || !envelope._meta || typeof envelope._meta !== 'object') throw new Error('invalid')
  const meta = envelope._meta as Record<string, unknown>
  const result = envelope.result as Record<string, unknown> | null
  const job = result?.job as Record<string, unknown> | undefined
  if (!job || typeof job !== 'object' || meta.runtimeId !== proof.runtimeId) throw new Error('invalid')
  const id = CloudId.safeParse(job.id)
  if (!id.success || typeof job.state !== 'string' || !CHILD_STATES.has(job.state) ||
      job.projectId !== input.projectId || job.requestKey !== input.requestKey || job.taskId !== input.taskId ||
      job.workspaceId !== input.workspaceId || job.sourceRevision !== input.sourceRevision ||
      job.targetDeviceId !== input.targetDeviceId || job.recipeId !== input.recipeId) throw new Error('invalid')
  return { id: id.data, state: job.state, projectId: input.projectId, requestKey: input.requestKey,
    sourceRevision: input.sourceRevision, targetDeviceId: input.targetDeviceId, recipeId: input.recipeId }
}
