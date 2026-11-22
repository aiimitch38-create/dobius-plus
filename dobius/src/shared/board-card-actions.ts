// `dobius board list|restart|rename|note|close`: main reads the saved Board to
// list and resolve cards, then asks the Board window to act (window IPC with a
// reply, the same main-to-renderer path `board.spawnConsole` and
// `board.open-tile` use). The renderer owns cards and tabs, so it does the work
// and re-checks the card against its live board. Pure: no store, no IPC.

export type BoardCardActionKind = 'restart' | 'rename' | 'note' | 'close'

/** Main asks the Board window to act on one card (or, for `note`, add one). */
export type BoardCardActionRequest = {
  requestId: string
  worktreeId: string
  action: BoardCardActionKind
  /** Resolved by main from the saved Board; optional only for `note` (no anchor card). */
  cardId?: string
  /** rename: the new title. */
  title?: string
  /** note: the note text. */
  text?: string
  /** restart/close: act even while the console's agent is mid-turn. */
  force?: boolean
}

export type BoardCardActionReply =
  | { requestId: string; ok: true; cardId: string; message: string }
  | { requestId: string; ok: false; code: string; message: string }

/** Reply codes the renderer may send; anything else becomes board_card_action_failed. */
export const BOARD_CARD_ACTION_REPLY_CODES = [
  'board_card_not_found',
  'board_card_busy',
  'board_card_wrong_kind',
  'board_card_action_failed',
  'board_window_unavailable'
] as const

export const BOARD_CARD_TITLE_MAX = 200
export const BOARD_NOTE_TEXT_MAX = 4000

export type ResolvableCard = { id: string; kind: string; title: string }

export type BoardCardResolution<T extends ResolvableCard> =
  | { ok: true; card: T }
  | { ok: false; reason: 'not-found' | 'ambiguous'; matches: T[] }

/**
 * Picks the one card a name refers to: a card id wins, otherwise the title,
 * ignoring letter case and surrounding spaces. Why two cards with the same
 * title (ignoring case) are refused instead of taking the first: it is the
 * same rule an orchestrator card uses for `@Name`, and acting on the wrong
 * card (closing the wrong agent) is worse than a refusal.
 */
export function resolveBoardCardName<T extends ResolvableCard>(
  cards: readonly T[],
  query: string
): BoardCardResolution<T> {
  const name = query.trim()
  const byId = cards.filter((c) => c.id === name)
  if (byId.length === 1) {
    return { ok: true, card: byId[0] }
  }
  const lower = name.toLowerCase()
  const byTitle = cards.filter((c) => c.title.trim().toLowerCase() === lower)
  if (byTitle.length === 1) {
    return { ok: true, card: byTitle[0] }
  }
  return byTitle.length > 1
    ? { ok: false, reason: 'ambiguous', matches: byTitle }
    : { ok: false, reason: 'not-found', matches: [] }
}
