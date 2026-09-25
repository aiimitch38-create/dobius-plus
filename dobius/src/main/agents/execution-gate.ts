import { errorCode, resolveAdamTarget, resolveAdamToken } from '../adam-connection'
import { getAgentsControlState } from './agents-config-store'

// 'agents-page' is the only operator origin; everything else is autonomous.
export type ExecutionOrigin = 'agents-page' | 'agent-run' | 'dispatch-build' | 'imessage-command'

export type ExecutionBlockReason = 'paused' | 'control-state-unreadable'

export type ExecutionAdmission =
  | { allowed: true }
  | { allowed: false; reason: ExecutionBlockReason; message: string }

// Only dispatch_build consults ADAM, so the pause-only callers keep the narrow type.
export type BuildDispatchAdmission =
  | ExecutionAdmission
  | { allowed: false; reason: 'adam-unavailable' | 'adam-refused'; message: string }

export class ExecutionBlockedError extends Error {
  readonly origin: ExecutionOrigin
  readonly reason: ExecutionBlockReason

  constructor(origin: ExecutionOrigin, reason: ExecutionBlockReason, message: string) {
    super(message)
    this.name = 'ExecutionBlockedError'
    this.origin = origin
    this.reason = reason
  }
}

export function checkExecutionAdmission(origin: ExecutionOrigin): ExecutionAdmission {
  if (origin === 'agents-page') {
    return { allowed: true }
  }
  let state: ReturnType<typeof getAgentsControlState>
  try {
    state = getAgentsControlState()
  } catch (error) {
    // Fail closed: if the pause state can't be determined, nothing autonomous starts.
    return {
      allowed: false,
      reason: 'control-state-unreadable',
      message: `Crew control state could not be read: ${error instanceof Error ? error.message : String(error)}`
    }
  }
  if (state.status === 'unreadable') {
    return {
      allowed: false,
      reason: 'control-state-unreadable',
      message: `Crew control file could not be read (${state.filePath}: ${state.detail}). Autonomous runs are blocked until it is fixed.`
    }
  }
  if (state.paused) {
    return {
      allowed: false,
      reason: 'paused',
      message: 'Crew is paused. Resume it on the Agents page to allow autonomous runs.'
    }
  }
  return { allowed: true }
}

// Bounds the whole handshake (connect, headers and body) so ADAM can never stall a dispatch.
export const ADAM_HANDSHAKE_TIMEOUT_MS = 5_000
const ADAM_REFUSAL_CODES = new Set([
  'unknown_project',
  'project_not_managed',
  'location_unverified',
  'readiness_too_low'
])
const ADAM_REASON_LIMIT = 300

function adamUnavailable(detail: string): BuildDispatchAdmission {
  return {
    allowed: false,
    reason: 'adam-unavailable',
    message: `ADAM could not approve this build (${detail}). Build dispatch stays blocked until ADAM answers.`
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

function adamText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, ADAM_REASON_LIMIT)
    : undefined
}

/**
 * ADAM's read-only context handshake (X12): may a build be launched into
 * `repoPath`? Fail closed: anything but a 200 with a context pack blocks.
 * Why intent 'launch' with the repo path: it is what ADAM's own
 * /v1/workers/launch checks (preflight.repo.path), and it can run before the
 * worktree or any paid agent exists.
 */
async function checkAdamHandshake(
  repoPath: string,
  timeoutMs: number
): Promise<BuildDispatchAdmission> {
  const target = resolveAdamTarget()
  if (!target.ok) {
    return adamUnavailable(`ADAM endpoint blocked: ${target.detail}`)
  }
  const token = await resolveAdamToken()
  if (token.token === undefined) {
    return adamUnavailable(
      token.state === 'not-installed' ? 'ADAM is not installed' : `no ADAM token: ${token.detail}`
    )
  }
  let status: number
  let body: Record<string, unknown> | undefined
  try {
    const response = await fetch(`${target.endpoint}/v1/context-handshake`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token.token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ worktreePath: repoPath, intent: 'launch' }),
      signal: AbortSignal.timeout(timeoutMs)
    })
    status = response.status
    // A malformed body is treated as "no pack" (blocks), but a timeout mid-body
    // must still report as a timeout.
    body = asRecord(
      await response.json().catch((error: unknown) => {
        if (asRecord(error)?.name === 'TimeoutError') {
          throw error
        }
        return undefined
      })
    )
  } catch (error) {
    if (asRecord(error)?.name === 'TimeoutError') {
      return adamUnavailable(`ADAM offline: no answer within ${timeoutMs} ms`)
    }
    // errno / error name only (fetch wraps ECONNREFUSED in `cause`): never the token.
    return adamUnavailable(`ADAM offline: ${errorCode(asRecord(error)?.cause ?? error)}`)
  }
  if (status === 200 && body?.ok === true && adamText(asRecord(body.contextPack)?.projectId)) {
    return { allowed: true }
  }
  if (status === 403) {
    const code = adamText(body?.code)
    const reason = adamText(body?.reason) ?? 'no reason given'
    return {
      allowed: false,
      reason: 'adam-refused',
      message: `ADAM refused this build (${code && ADAM_REFUSAL_CODES.has(code) ? code : 'refused'}): ${reason}`
    }
  }
  if (status === 404) {
    return adamUnavailable('ADAM needs updating: it has no context-handshake route')
  }
  if (status === 401) {
    return adamUnavailable('ADAM rejected the Dobius+ token (HTTP 401)')
  }
  return adamUnavailable(
    status === 200 ? 'ADAM answered without a context pack' : `ADAM answered HTTP ${status}`
  )
}

/**
 * Admission for dispatch_build: the pause gate, then ADAM's handshake for the
 * repo, then the pause gate again (a pause during the handshake still wins).
 * Manual runs never come here; they stay pause-only.
 */
export async function checkBuildDispatchAdmission(
  repoPath: string,
  options: { timeoutMs?: number } = {}
): Promise<BuildDispatchAdmission> {
  const before = checkExecutionAdmission('dispatch-build')
  if (!before.allowed) {
    return before
  }
  const adam = await checkAdamHandshake(repoPath, options.timeoutMs ?? ADAM_HANDSHAKE_TIMEOUT_MS)
  if (!adam.allowed) {
    return adam
  }
  return checkExecutionAdmission('dispatch-build')
}

export function assertExecutionAdmitted(origin: ExecutionOrigin): void {
  const admission = checkExecutionAdmission(origin)
  if (!admission.allowed) {
    throw new ExecutionBlockedError(origin, admission.reason, admission.message)
  }
}

// Why: name check, not instanceof, so dynamically imported module copies still match.
export function isExecutionBlockedError(error: unknown): error is ExecutionBlockedError {
  return error instanceof Error && error.name === 'ExecutionBlockedError'
}
