import { errorCode, resolveAdamTarget, resolveAdamToken } from '../adam-connection'
import { getAgentsControlState } from './agents-config-store'

// 'agents-page' is the only operator origin; everything else is autonomous.
export type ExecutionOrigin = 'agents-page' | 'agent-run' | 'dispatch-build' | 'imessage-command'

export type ExecutionBlockReason = 'paused' | 'control-state-unreadable'
export type AdamBlockReason = 'adam-unavailable' | 'adam-refused'

export type ExecutionAdmission =
  | { allowed: true }
  | { allowed: false; reason: ExecutionBlockReason; message: string }

/** What ADAM admitted the work into; threaded onto the run and its events. */
export type AdamContextPack = { projectId: string; digest?: string }

// dispatch_build and every autonomous run consult ADAM; the pause-only callers
// (manual runs) keep the narrow ExecutionAdmission type.
export type AdamAdmission =
  | { allowed: true; contextPack: AdamContextPack }
  | { allowed: false; reason: ExecutionBlockReason | AdamBlockReason; message: string }
export type BuildDispatchAdmission = AdamAdmission

export class ExecutionBlockedError extends Error {
  readonly origin: ExecutionOrigin
  readonly reason: ExecutionBlockReason | AdamBlockReason

  constructor(
    origin: ExecutionOrigin,
    reason: ExecutionBlockReason | AdamBlockReason,
    message: string
  ) {
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

// What ADAM is being asked to admit; only the operator-facing wording differs.
type AdamSubject = 'build' | 'run'

function adamUnavailable(detail: string, subject: AdamSubject): AdamAdmission {
  return {
    allowed: false,
    reason: 'adam-unavailable',
    message:
      subject === 'build'
        ? `ADAM could not approve this build (${detail}). Build dispatch stays blocked until ADAM answers.`
        : `ADAM could not approve this run (${detail}). Autonomous runs stay blocked until ADAM answers.`
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
 * ADAM's read-only context handshake (X12): may a build or an agent run be
 * launched into `repoPath`? Fail closed: anything but a 200 with a context
 * pack blocks. Why intent 'launch' with the path: it is what ADAM's own
 * /v1/workers/launch checks (preflight.repo.path), and it can run before the
 * worktree or any paid agent exists.
 */
async function checkAdamHandshake(
  repoPath: string,
  timeoutMs: number,
  subject: AdamSubject
): Promise<AdamAdmission> {
  const target = resolveAdamTarget()
  if (!target.ok) {
    return adamUnavailable(`ADAM endpoint blocked: ${target.detail}`, subject)
  }
  const token = await resolveAdamToken()
  if (token.token === undefined) {
    return adamUnavailable(
      token.state === 'not-installed' ? 'ADAM is not installed' : `no ADAM token: ${token.detail}`,
      subject
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
      return adamUnavailable(`ADAM offline: no answer within ${timeoutMs} ms`, subject)
    }
    // errno / error name only (fetch wraps ECONNREFUSED in `cause`): never the token.
    return adamUnavailable(
      `ADAM offline: ${errorCode(asRecord(error)?.cause ?? error)}`,
      subject
    )
  }
  const pack = asRecord(body?.contextPack)
  const projectId = adamText(pack?.projectId)
  if (status === 200 && body?.ok === true && projectId) {
    const digest = adamText(pack?.digest)
    return { allowed: true, contextPack: { projectId, ...(digest ? { digest } : {}) } }
  }
  if (status === 403) {
    const code = adamText(body?.code)
    const reason = adamText(body?.reason) ?? 'no reason given'
    return {
      allowed: false,
      reason: 'adam-refused',
      message: `ADAM refused this ${subject} (${code && ADAM_REFUSAL_CODES.has(code) ? code : 'refused'}): ${reason}`
    }
  }
  if (status === 404) {
    return adamUnavailable('ADAM needs updating: it has no context-handshake route', subject)
  }
  if (status === 401) {
    return adamUnavailable('ADAM rejected the Dobius+ token (HTTP 401)', subject)
  }
  return adamUnavailable(
    status === 200 ? 'ADAM answered without a context pack' : `ADAM answered HTTP ${status}`,
    subject
  )
}

// The pause gate, then ADAM's handshake for the path, then the pause gate
// again (a pause during the handshake still wins).
async function checkAdamAdmission(
  origin: ExecutionOrigin,
  repoPath: string,
  subject: AdamSubject,
  timeoutMs: number
): Promise<AdamAdmission> {
  const before = checkExecutionAdmission(origin)
  if (!before.allowed) {
    return before
  }
  const adam = await checkAdamHandshake(repoPath, timeoutMs, subject)
  if (!adam.allowed) {
    return adam
  }
  const after = checkExecutionAdmission(origin)
  return after.allowed ? adam : after
}

/**
 * Admission for dispatch_build: pause → ADAM handshake for the repo → pause.
 * Manual runs never come here; they stay pause-only.
 */
export async function checkBuildDispatchAdmission(
  repoPath: string,
  options: { timeoutMs?: number } = {}
): Promise<BuildDispatchAdmission> {
  return checkAdamAdmission(
    'dispatch-build',
    repoPath,
    'build',
    options.timeoutMs ?? ADAM_HANDSHAKE_TIMEOUT_MS
  )
}

/**
 * Admission for an autonomous agent run into `cwd`: the same pause → ADAM →
 * pause sequence as dispatch_build. Callers pass the run's resolved cwd; ADAM
 * matches it against its project registry.
 */
export async function checkRunAdmission(
  origin: ExecutionOrigin,
  cwd: string,
  options: { timeoutMs?: number } = {}
): Promise<AdamAdmission> {
  return checkAdamAdmission(origin, cwd, 'run', options.timeoutMs ?? ADAM_HANDSHAKE_TIMEOUT_MS)
}

export function assertExecutionAdmitted(origin: ExecutionOrigin): void {
  const admission = checkExecutionAdmission(origin)
  if (!admission.allowed) {
    throw new ExecutionBlockedError(origin, admission.reason, admission.message)
  }
}

/**
 * Run-entry admission. Manual Agents-page runs are the only operator origin
 * and stay pause-only (no ADAM call, no context pack); every other origin
 * must be admitted by ADAM before anything is reserved or spawned.
 */
export async function assertRunAdmitted(
  origin: ExecutionOrigin,
  cwd: string
): Promise<AdamContextPack | undefined> {
  if (origin === 'agents-page') {
    assertExecutionAdmitted(origin)
    return undefined
  }
  const admission = await checkRunAdmission(origin, cwd)
  if (!admission.allowed) {
    throw new ExecutionBlockedError(origin, admission.reason, admission.message)
  }
  return admission.contextPack
}

// Why: name check, not instanceof, so dynamically imported module copies still match.
export function isExecutionBlockedError(error: unknown): error is ExecutionBlockedError {
  return error instanceof Error && error.name === 'ExecutionBlockedError'
}
