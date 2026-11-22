// The "a human must click in the app" gate for RPC calls that approve things
// (resume the crew, post an agent's draft, answer an agent's tool request).
// Why: interactive Dobius terminals hold the full runtime key, so an agent can
// call these RPC methods exactly as a person would. The only proof of a human
// is a click in the app's own dialog. Pure logic here; the Electron dialog is
// in crew-confirm.ts so tests can inject a fake.
import type { PendingAgentDecision } from '../../../../shared/agents'
import type { RpcContext } from '../core'

export type ConfirmRequest = {
  title: string
  message: string
  detail: string
  confirmLabel: string
}

// Resolves true only when the human pressed the confirm button. Aborting the
// signal must close the dialog as if Cancel was pressed.
export type ConfirmDialog = (request: ConfirmRequest, signal: AbortSignal) => Promise<boolean>

export type ConfirmationGate = (request: ConfirmRequest, ctx: RpcContext) => Promise<void>

// Why: the CLI's local socket closes after 30 s idle (unix-socket-transport.ts),
// so the dialog closes itself before then. An answer nobody is waiting for
// must not act.
export const CONFIRM_WINDOW_MS = 25_000
// Why: a looping caller must not be able to reopen the dialog the instant the
// human cancels it.
export const CONFIRM_COOLDOWN_MS = 10_000
// Longer than this cannot be read in a dialog, so it is refused, never clipped.
export const CONFIRM_TEXT_LIMIT = 1500

export class ConfirmTextTooLongError extends Error {}

// Control characters, zero-width characters and bidi overrides: anything that
// could make the dialog show something other than what will run.
const HIDDEN_CHARACTERS = new RegExp(
  '[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2066-\\u2069\\ufeff]+',
  'g'
)

export function createConfirmationGate(
  dialog: ConfirmDialog,
  options: { windowMs?: number; cooldownMs?: number; now?: () => number } = {}
): ConfirmationGate {
  const windowMs = options.windowMs ?? CONFIRM_WINDOW_MS
  const cooldownMs = options.cooldownMs ?? CONFIRM_COOLDOWN_MS
  const now = options.now ?? Date.now
  let open = false
  let blockedUntil = 0

  return async (request, ctx) => {
    if (open) {
      throw new Error('Another confirmation is already open in Dobius+. Answer it first.')
    }
    if (now() < blockedUntil) {
      throw new Error('The last confirmation was declined. Wait a few seconds before asking again.')
    }
    open = true
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), windowMs)
    let accepted = false
    try {
      accepted = await dialog(request, controller.signal)
    } finally {
      clearTimeout(timer)
      open = false
    }
    const expired = controller.signal.aborted
    if (!accepted || expired) {
      blockedUntil = now() + cooldownMs
    }
    if (expired) {
      throw new Error('Not confirmed in time in Dobius+, so nothing was changed.')
    }
    if (!accepted) {
      throw new Error('Not confirmed in Dobius+, so nothing was changed.')
    }
    if (ctx.signal?.aborted) {
      throw new Error('The request was cancelled while waiting for confirmation.')
    }
  }
}

// Collapses whitespace and removes control characters so the dialog shows
// what will run. Refuses text too long to show in full.
export function confirmText(value: string, what: string): string {
  const shown = value.replace(HIDDEN_CHARACTERS, ' ').replace(/\s+/g, ' ').trim()
  if (value.length > CONFIRM_TEXT_LIMIT) {
    throw new ConfirmTextTooLongError(
      `The ${what} is too long to confirm here. Approve it in the Dobius+ app instead.`
    )
  }
  return shown
}

export function describeCaller(ctx: RpcContext): string {
  return ctx.clientKind === 'mobile'
    ? 'Asked by a paired phone.'
    : 'Asked through the Dobius+ runtime (the dobius command line, or an agent in a terminal).'
}

function stringifyInput(input: unknown): string {
  try {
    return JSON.stringify(input) ?? ''
  } catch {
    return '[input could not be shown]'
  }
}

export type DecisionChoice = 'approve' | 'deny' | 'respond'

export function decisionConfirmRequest(
  decision: PendingAgentDecision,
  choice: DecisionChoice,
  note: string | undefined,
  ctx: RpcContext
): ConfirmRequest {
  const label = confirmText(decision.title ?? decision.displayName ?? decision.toolName, 'title')
  return {
    title: 'Answer an agent request?',
    message: `Answer "${label}" with: ${choice}`,
    detail: [
      describeCaller(ctx),
      `Agent: ${confirmText(decision.agentId, 'agent id')}`,
      `Tool: ${confirmText(decision.toolName, 'tool name')}`,
      `Folder: ${confirmText(decision.cwd ?? '', 'folder')}`,
      `Input: ${confirmText(stringifyInput(decision.input), 'tool input')}`,
      ...(note ? [`Note to the agent: ${confirmText(note, 'note')}`] : [])
    ].join('\n'),
    confirmLabel: choice === 'approve' ? 'Approve' : 'Send answer'
  }
}
