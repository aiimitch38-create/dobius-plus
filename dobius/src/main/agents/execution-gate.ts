import { getAgentsControlState } from './agents-config-store'

// 'agents-page' is the only operator origin; everything else is autonomous.
export type ExecutionOrigin = 'agents-page' | 'agent-run' | 'dispatch-build' | 'imessage-command'

export type ExecutionBlockReason = 'paused' | 'control-state-unreadable'

export type ExecutionAdmission =
  | { allowed: true }
  | { allowed: false; reason: ExecutionBlockReason; message: string }

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
