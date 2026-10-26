// Why: a card drag writes new x/y into the store on every pointer move. The Board
// route (top bar, rails, command bar, studios, hooks) only cares about which
// cards exist and what they are, so it reads this geometry-insensitive view and
// re-renders only when the board's *shape* changes. The cards layer alone
// subscribes to live positions. Measured before this split: ~14 ms of React work
// per pointer move re-rendering the whole chrome.
import type { AppState } from '@/store/types'
import { EMPTY_BOARD, getBoard, type BoardCard, type BoardState } from '@/store/slices/board'

const GEOMETRY_KEYS: ReadonlySet<string> = new Set(['x', 'y', 'w', 'h', 'z'])

/** True when the two cards differ only in position, size or stacking. */
export function sameCardShape(a: BoardCard, b: BoardCard): boolean {
  if (a === b) {
    return true
  }
  const ra = a as unknown as Record<string, unknown>
  const rb = b as unknown as Record<string, unknown>
  const keys = Object.keys(ra)
  if (keys.length !== Object.keys(rb).length) {
    return false
  }
  for (const key of keys) {
    if (GEOMETRY_KEYS.has(key)) {
      continue
    }
    if (!(key in rb) || ra[key] !== rb[key]) {
      return false
    }
  }
  return true
}

/** True when the boards differ only in card geometry (viewport, tool, groups, connectors must match). */
export function sameBoardShape(a: BoardState, b: BoardState): boolean {
  if (a === b) {
    return true
  }
  if (a.cards !== b.cards) {
    if (a.cards.length !== b.cards.length) {
      return false
    }
    for (let i = 0; i < a.cards.length; i++) {
      if (!sameCardShape(a.cards[i], b.cards[i])) {
        return false
      }
    }
  }
  const ra = a as unknown as Record<string, unknown>
  const rb = b as unknown as Record<string, unknown>
  const keys = Object.keys(ra)
  if (keys.length !== Object.keys(rb).length) {
    return false
  }
  for (const key of keys) {
    if (key === 'cards') {
      continue
    }
    if (!(key in rb) || ra[key] !== rb[key]) {
      return false
    }
  }
  return true
}

/**
 * Store selector for `worktreeId`'s board that keeps returning the previous
 * board object while only card geometry changes, so `useAppStore(selector)`
 * does not re-render its component on a drag or resize. One instance per
 * subscriber (it remembers the last result).
 */
export function boardShapeSelector(
  worktreeId: string | null
): (state: Pick<AppState, 'boardsByWorktree'>) => BoardState {
  let previous: BoardState = EMPTY_BOARD
  return (state) => {
    const next = getBoard(state, worktreeId)
    if (sameBoardShape(previous, next)) {
      return previous
    }
    previous = next
    return next
  }
}

/** Console cards per worktree, for the workspace tabs; shallow-equal across position-only changes. */
export function consoleCountsByWorktree(
  boards: Record<string, Pick<BoardState, 'cards'>>
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const [id, board] of Object.entries(boards)) {
    counts[id] = board.cards.filter((c) => c.kind === 'console').length
  }
  return counts
}
