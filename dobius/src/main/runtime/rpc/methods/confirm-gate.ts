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

// Control characters (Cc) and every invisible format character (Cf: zero-width,
// soft hyphen, word joiner, bidi marks and overrides, BOM), plus the line and
// paragraph separators: anything that could make the dialog show something
// other than what will run.
const HIDDEN_CHARACTERS = /[\p{Cc}\p{Cf}\u2028\u2029]+/gu

export function createConfirmationGate(
  dialog: ConfirmDialog,
  options: { windowMs?: number; cooldownMs?: number; now?: () => number } = {}
): ConfirmationGate {
  const windowMs = options.windowMs ?? CONFIRM_WINDOW_MS
  const cooldownMs = options.cooldownMs ?? CONFIRM_COOLDOWN_MS
  // Why: monotonic, so a wall-clock change cannot stretch the window or the
  // cooldown.
  const now = options.now ?? (() => performance.now())
  let open = false
  let blockedUntil = -Infinity

  return async (request, ctx) => {
    if (ctx.signal?.aborted) {
      throw new Error('The request was already cancelled, so no confirmation was shown.')
    }
    if (open) {
      throw new Error('Another confirmation is already open in Dobius+. Answer it first.')
    }
    if (now() < blockedUntil) {
      throw new Error('The last confirmation was declined. Wait a few seconds before asking again.')
    }
    open = true
    const deadline = now() + windowMs
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, windowMs)
    // Why: if the caller disconnects, nobody will read the answer, so close
    // the dialog rather than leave a question that can still be clicked.
    const onCallerAbort = (): void => controller.abort()
    ctx.signal?.addEventListener('abort', onCallerAbort, { once: true })
    let accepted = false
    try {
      accepted = await dialog(request, controller.signal)
    } finally {
      clearTimeout(timer)
      ctx.signal?.removeEventListener('abort', onCallerAbort)
      open = false
    }
    // Why: the timer can fire late (a busy main thread) and a dialog can
    // ignore its signal, so the deadline is checked again here.
    const expired = timedOut || now() >= deadline
    const callerGone = ctx.signal?.aborted === true
    if (!accepted || expired || callerGone) {
      blockedUntil = now() + cooldownMs
    }
    if (callerGone) {
      throw new Error('The request was cancelled while waiting for confirmation.')
    }
    if (expired) {
      throw new Error('Not confirmed in time in Dobius+, so nothing was changed.')
    }
    if (!accepted) {
      throw new Error('Not confirmed in Dobius+, so nothing was changed.')
    }
  }
}

/**
 * True when text holds a character the dialog would not show (control,
 * format, bidi, zero-width, tag, line/paragraph separator), apart from
 * newline and tab. Why: the dialog strips them, so text that acts with them
 * would differ from what the human approved; such text is refused instead.
 */
export function hasHiddenCharacters(value: string): boolean {
  return Array.from(value).some(
    (character) =>
      character !== '\n' && character !== '\t' && /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(character)
  )
}

export const HIDDEN_CHARACTERS_MESSAGE =
  'Text has hidden or control characters; remove them and send it again'

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
