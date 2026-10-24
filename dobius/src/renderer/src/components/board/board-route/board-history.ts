import type { BoardState } from '@/store/slices/board'

// Undo covers what the user made (cards, groups, connectors), never the camera
// or the active tool, so panning around doesn't fill the history.
export type BoardContent = Pick<BoardState, 'cards' | 'groups' | 'connectors'>
export type BoardHistory = { past: BoardContent[]; future: BoardContent[] }

export const BOARD_HISTORY_CAP = 100
export const EMPTY_BOARD_HISTORY: BoardHistory = { past: [], future: [] }

export function boardContentOf(board: BoardState): BoardContent {
  return { cards: board.cards, groups: board.groups, connectors: board.connectors }
}

/** Store updates keep untouched arrays by identity, so identity equality is exact here. */
export function sameBoardContent(a: BoardContent, b: BoardContent): boolean {
  return a.cards === b.cards && a.groups === b.groups && a.connectors === b.connectors
}

/** A finished edit: `before` becomes undoable and any redo branch is dropped. */
export function recordBoardChange(
  history: BoardHistory,
  before: BoardContent,
  cap = BOARD_HISTORY_CAP
): BoardHistory {
  const past = [...history.past, before]
  return { past: past.length > cap ? past.slice(past.length - cap) : past, future: [] }
}

export function undoBoardStep(
  history: BoardHistory,
  current: BoardContent
): { history: BoardHistory; content: BoardContent } | null {
  const content = history.past.at(-1)
  if (!content) {
    return null
  }
  return {
    content,
    history: { past: history.past.slice(0, -1), future: [...history.future, current] }
  }
}

export function redoBoardStep(
  history: BoardHistory,
  current: BoardContent
): { history: BoardHistory; content: BoardContent } | null {
  const content = history.future.at(-1)
  if (!content) {
    return null
  }
  return {
    content,
    history: { past: [...history.past, current], future: history.future.slice(0, -1) }
  }
}

/**
 * Console cards stand for live terminals, so undo/redo never adds or removes one
 * on its own. A snapshot's console is restored only if its tab is alive or the
 * card is on the board now (a closed agent's card the user still sees must not
 * vanish because an unrelated step is undone). A console on the board now that
 * the snapshot lacks is always kept. Groups keep only members that survive.
 */
export function reconcileConsoleCards(
  target: BoardContent,
  current: BoardContent,
  liveTabIds: ReadonlySet<string>
): BoardContent {
  const onBoard = new Set(current.cards.map((c) => c.id))
  const keep = (card: BoardContent['cards'][number]): boolean =>
    card.kind !== 'console' || liveTabIds.has(card.tabId) || onBoard.has(card.id)
  const cards = target.cards.filter(keep)
  const ids = new Set(cards.map((c) => c.id))
  for (const card of current.cards) {
    if (card.kind === 'console' && !ids.has(card.id)) {
      cards.push(card)
      ids.add(card.id)
    }
  }
  const groups = target.groups
    .map((g) => ({ ...g, cardIds: g.cardIds.filter((id) => ids.has(id)) }))
    .filter((g) => g.cardIds.length > 0)
  return { ...target, cards, groups }
}
