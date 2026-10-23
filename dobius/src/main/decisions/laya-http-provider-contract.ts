import { z } from 'zod'
import {
  LAYA_ADVISORY_POLICY_VERSION,
  LAYA_ADVISORY_SCHEMA_VERSION,
  LayaAdvisorySurface,
  LayaDeploymentGate,
  LayaProviderDecision,
  LayaProviderRequest,
  labelsForSurface,
  type LayaAdvisorySurface as Surface,
  type LayaProviderDecision as ProviderDecision,
  type LayaProviderRequest as ProviderRequest
} from '../../shared/laya-advisory'

export const MAX_REQUEST_BYTES = 16_384
export const MAX_RESPONSE_BYTES = 32_768
export const DEFAULT_DEADLINE_MS = 1_500
export const MAX_DEADLINE_MS = 2_000
export const EXPECTED_MODEL = 'multilingual'
export const EXPECTED_SOURCE_REVISION = '3cf26cbcb18725dbc2d127bb8bb2c4c43243ae63'
export const EXPECTED_CHECKPOINT_REVISION = '7b928d828b7b0e022f929d9bd2e44165aa270148'
export const QUESTION_ID = 'dobius_decision'
const SupportedSurface = new Set<Surface>(LayaAdvisorySurface.options)

export function isSupportedSurface(surface: unknown): surface is Surface {
  return typeof surface === 'string' && SupportedSurface.has(surface as Surface)
}

export const TrustedDeploymentReceipt = z
  .object({
    endpoint: z.string().url(),
    model: z.literal(EXPECTED_MODEL),
    gate: LayaDeploymentGate
  })
  .strict()

export type Receipt = z.infer<typeof TrustedDeploymentReceipt>

export type LayaHttpProviderOptions = {
  /** Trusted local receipt reader; its result is checked before and after network awaits. */
  readDeploymentReceipt: (signal: AbortSignal) => Promise<unknown>
  /** Resolves an operator-owned secret; the returned value is never persisted or logged. */
  resolveAuthorization: (signal: AbortSignal) => Promise<string | null>
  /** Synchronous coherent deployment/authority epoch supplied by trusted main-process wiring. */
  readEpoch: () => unknown
  fetch?: typeof fetch
  now?: () => number
  monotonicNow?: () => number
  deadlineMs?: number
}

export function strictLayaProviderRequest(raw: unknown): ProviderRequest {
  const request = LayaProviderRequest.parse(raw)
  const allowed = new Set(labelsForSurface(request.surface))
  const dynamicChoiceSurface = request.surface === 'job-routing' || request.surface === 'storage'
  if (
    request.choices.length < 2 ||
    new Set(request.choices).size !== request.choices.length ||
    (!dynamicChoiceSurface && request.choices.some((choice) => !allowed.has(choice)))
  ) {
    throw new Error('Laya provider request choices do not match the supported surface labels.')
  }
  return request
}

export function loopbackEndpoint(raw: string): URL {
  const url = new URL(raw)
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (
    url.protocol !== 'http:' ||
    (hostname !== '127.0.0.1' && hostname !== '::1') ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Laya endpoint must be a plain HTTP loopback origin.')
  }
  return url
}

export function validEpoch(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) < Number.MAX_SAFE_INTEGER
  )
}

export function assertNotAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw new Error('Laya HTTP request was aborted.')
  }
}

export function authorizationHeader(value: unknown): string {
  if (typeof value !== 'string' || !/^[^\s\r\n]+$/.test(value)) {
    throw new Error('Laya authorization is unavailable.')
  }
  return `Bearer ${value}`
}

export function boundedDeadline(value: number | undefined): number {
  const timeout = value ?? DEFAULT_DEADLINE_MS
  if (!Number.isSafeInteger(timeout) || timeout < 50 || timeout > MAX_DEADLINE_MS) {
    throw new Error(`Laya HTTP deadline must be an integer from 50 to ${MAX_DEADLINE_MS}ms.`)
  }
  return timeout
}

export function linkedDeadline(parent: AbortSignal, timeoutMs: number) {
  const controller = new AbortController()
  const abortParent = () => controller.abort(parent.reason)
  if (parent.aborted) {
    abortParent()
  } else {
    parent.addEventListener('abort', abortParent, { once: true })
  }
  const timer = setTimeout(
    () => controller.abort(new Error('Laya HTTP deadline exceeded.')),
    timeoutMs
  )
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer)
      parent.removeEventListener('abort', abortParent)
    }
  }
}

export async function readJsonBounded(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') {
    throw new Error('Laya response content type is not application/json.')
  }
  const length = response.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) {
    throw new Error('Laya response exceeds the configured size limit.')
  }
  if (!response.body) {
    throw new Error('Laya response has no body.')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new Error('Laya response exceeds the configured size limit.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
}

export function parseHealth(raw: unknown, receipt: Receipt): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return false
  }
  const health = raw as Record<string, unknown>
  const loaded = health.loaded
  const revisions = health.revisions
  return (
    health.status === 'ok' &&
    Array.isArray(loaded) &&
    loaded.includes(receipt.model) &&
    revisions !== null &&
    typeof revisions === 'object' &&
    !Array.isArray(revisions) &&
    (revisions as Record<string, unknown>)[receipt.model] === receipt.gate.checkpointRevision
  )
}

function probability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

export function parseChoiceResponse(
  raw: unknown,
  receipt: Receipt,
  request: ProviderRequest,
  providerMeasuredAt: number
): ProviderDecision {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid Laya response.')
  }
  const root = raw as Record<string, unknown>
  if (
    Object.keys(root).some((key) => !['model', 'answers', 'usage', 'routing'].includes(key)) ||
    root.model !== receipt.model ||
    !root.answers ||
    typeof root.answers !== 'object' ||
    Array.isArray(root.answers) ||
    Object.keys(root.answers).length !== 1 ||
    !(QUESTION_ID in root.answers)
  ) {
    throw new Error('Laya response model or answer envelope did not match the request.')
  }
  const answer = (root.answers as Record<string, unknown>)[QUESTION_ID]
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) {
    throw new Error('Laya returned an invalid choice answer.')
  }
  const value = answer as Record<string, unknown>
  const permittedAnswerKeys = [
    'type',
    'choice',
    'probabilities',
    'confidence',
    'action',
    'answer_confidence'
  ]
  if (
    Object.keys(value).some((key) => !permittedAnswerKeys.includes(key)) ||
    value.type !== 'choice' ||
    typeof value.choice !== 'string' ||
    !request.choices.includes(value.choice) ||
    !value.probabilities ||
    typeof value.probabilities !== 'object' ||
    Array.isArray(value.probabilities)
  ) {
    throw new Error('Laya returned an invalid or out-of-label choice.')
  }
  if (!root.usage || typeof root.usage !== 'object' || Array.isArray(root.usage)) {
    throw new Error('Laya returned malformed usage metadata.')
  }
  const usage = root.usage as Record<string, unknown>
  if (
    !Number.isSafeInteger(usage.input_tokens) ||
    Number(usage.input_tokens) < 0 ||
    !Number.isSafeInteger(usage.output_tokens) ||
    Number(usage.output_tokens) < 0
  ) {
    throw new Error('Laya usage counters must be nonnegative safe integers.')
  }
  if (
    root.routing !== undefined &&
    (!root.routing || typeof root.routing !== 'object' || Array.isArray(root.routing))
  ) {
    throw new Error('Laya returned malformed routing metadata.')
  }
  if (
    (value.confidence !== undefined && !probability(value.confidence)) ||
    (value.answer_confidence !== undefined && !probability(value.answer_confidence)) ||
    (value.action !== undefined && typeof value.action !== 'string')
  ) {
    throw new Error('Laya returned malformed optional choice metadata.')
  }
  const probabilities = value.probabilities as Record<string, unknown>
  const labels = request.choices
  const entries = Object.entries(probabilities)
  if (
    entries.length !== labels.length ||
    entries.some(([label, score]) => !labels.includes(label) || !probability(score))
  ) {
    throw new Error('Laya probabilities must cover exactly the allowed labels.')
  }
  const total = entries.reduce((sum, [, score]) => sum + Number(score), 0)
  const best = entries.reduce((top, entry) => (Number(entry[1]) > Number(top[1]) ? entry : top))
  if (
    Math.abs(total - 1) > 1e-6 ||
    best[0] !== value.choice ||
    (value.confidence !== undefined &&
      Math.abs(Number(value.confidence) - Number(probabilities[value.choice])) > 1e-6)
  ) {
    throw new Error('Laya probabilities are not normalized or do not support its selected choice.')
  }
  return LayaProviderDecision.parse({
    schemaVersion: LAYA_ADVISORY_SCHEMA_VERSION,
    surface: request.surface,
    requestDigest: request.requestDigest,
    snapshotRevision: request.snapshotRevision,
    sourceRevision: receipt.gate.sourceRevision,
    checkpointRevision: receipt.gate.checkpointRevision,
    evaluationReportSha256: receipt.gate.evaluationReportSha256,
    policyVersion: LAYA_ADVISORY_POLICY_VERSION,
    decision: value.choice,
    confidence: Number(probabilities[value.choice]),
    probabilities,
    elapsedMs: 0,
    providerMeasuredAt
  })
}
