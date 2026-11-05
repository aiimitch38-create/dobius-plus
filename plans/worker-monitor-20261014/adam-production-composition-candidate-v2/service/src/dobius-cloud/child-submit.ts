import { isAbsolute } from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  AdamCloudChildSubmitError,
  AdamSubmissionProofSchema,
  parseAdamCloudChildRequest,
  type AdamCloudChild,
  type AdamCloudChildRequest,
  type AdamCloudSubmissionAuthority,
  type AdamCloudSubmissionProof
} from './child-submit-contract.js'
import { remainingSubmitMs, runLocalChildSubmit } from './child-submit-process.js'
import type { DurableApprovedIntentSubmission } from './receipt-store.js'
import type { TrustedApprovedCloudDecision } from './approved-decision-contract.js'
import type { DobiusApprovedIntentCli, ApprovedIntentChild } from './intent-bridge-cli.js'

/** Production approved path submits only the persisted sealed DTO over the strict v1 stdin contract. */
export function submitAdamApprovedIntent(
  dto: DurableApprovedIntentSubmission,
  decision: TrustedApprovedCloudDecision,
  bridge: Pick<DobiusApprovedIntentCli, 'submit'>,
  assertDecisionCurrent: () => void,
  signal?: AbortSignal
): Promise<ApprovedIntentChild> {
  return bridge.submit(dto, decision, assertDecisionCurrent, signal)
}

export type AdamCloudChildSubmitOptions = {
  executablePath: string
  authority: AdamCloudSubmissionAuthority
  spawnProcess?: typeof import('node:child_process').spawn
  now?: () => number
  deadlineMs?: number
}

/** The proof must identify an enabled local runtime and stay current through child completion. */
export async function submitAdamCloudChild(
  rawRequest: unknown,
  options: AdamCloudChildSubmitOptions
): Promise<AdamCloudChild> {
  let request: AdamCloudChildRequest
  try { request = parseAdamCloudChildRequest(rawRequest) }
  catch (error) {
    if (error instanceof AdamCloudChildSubmitError) throw error
    throw new AdamCloudChildSubmitError('invalid-request')
  }
  if (!isAbsolute(options.executablePath) || options.executablePath.length > 4096) throw new AdamCloudChildSubmitError('invalid-request')
  const deadlineMs = options.deadlineMs ?? 10_000
  if (!Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 30_000) throw new AdamCloudChildSubmitError('invalid-request')
  const deadlineAt = performance.now() + deadlineMs
  const abort = new AbortController()

  let proofPromise: Promise<unknown | null>
  try { proofPromise = options.authority.acquire(request, abort.signal) }
  catch { throw new AdamCloudChildSubmitError('not-ready') }
  const proofRaw = await waitForProof(proofPromise, deadlineAt, () => abort.abort())
  const parsedProof = AdamSubmissionProofSchema.safeParse(proofRaw)
  if (!parsedProof.success) throw new AdamCloudChildSubmitError('not-ready')
  const proof = parsedProof.data
  const now = options.now ?? Date.now
  assertCurrent(options.authority, proof, request, now)

  return runLocalChildSubmit(request, proof, {
    executablePath: options.executablePath,
    deadlineAt,
    assertProofCurrent: () => assertCurrent(options.authority, proof, request, now),
    ...(options.spawnProcess ? { spawnProcess: options.spawnProcess } : {})
  })
}

function assertCurrent(
  authority: AdamCloudSubmissionAuthority,
  proof: AdamCloudSubmissionProof,
  request: AdamCloudChildRequest,
  now: () => number
): void {
  try {
    const currentTime = now()
    if (!Number.isSafeInteger(currentTime) || currentTime < 0) {
      throw new AdamCloudChildSubmitError('not-ready')
    }
    if (!isAbsolute(proof.runtimeUserDataPath) ||
      proof.projectId !== request.input.projectId ||
      proof.bindingId !== request.grant.bindingId ||
      proof.requestFingerprint !== request.grant.requestFingerprint ||
      proof.expiresAtMs !== request.grant.expiresAtMs ||
      proof.expiresAtMs <= currentTime || !authority.isCurrent(proof)) {
      throw new AdamCloudChildSubmitError('not-ready')
    }
  } catch {
    throw new AdamCloudChildSubmitError('not-ready')
  }
}

function waitForProof<T>(promise: Promise<T>, deadlineAt: number, onTimeout: () => void): Promise<T> {
  let timeoutMs: number
  try { timeoutMs = remainingSubmitMs(deadlineAt) }
  catch { onTimeout(); return Promise.reject(new AdamCloudChildSubmitError('deadline')) }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { onTimeout() } catch { /* The deadline failure remains the public result. */ }
      reject(new AdamCloudChildSubmitError('deadline'))
    }, timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        if (performance.now() >= deadlineAt) reject(new AdamCloudChildSubmitError('deadline'))
        else resolve(value)
      },
      () => {
        clearTimeout(timer)
        reject(new AdamCloudChildSubmitError('not-ready'))
      }
    )
  })
}
