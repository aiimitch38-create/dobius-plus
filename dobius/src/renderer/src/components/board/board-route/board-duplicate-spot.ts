import { boardBoxIsFree, boardFreeSpawnCenter } from '../board-canvas/board-spawn-placement'
import type { BoardPoint } from '../board-canvas/board-viewport'
import { translate } from '@/i18n/i18n'
import type { BoardCard, NewBoardCard } from '@/store/slices/board'

type Box = { x: number; y: number; w: number; h: number }

const GAP = 32
// How far a duplicate may look for room before the shared placement's own
// fallback (just right of the rightmost card) takes over.
const SEARCH_COLUMNS = 3
const SEARCH_ROWS = 3

/**
 * Top-left for a copy of `source`, same size, beside it. Tries the four
 * neighbouring slots first (right, below, left, above) so the copy sits next to
 * its source; only when all four are taken does it scan the area around the
 * source, and it never covers another card.
 */
export function duplicateSpot(source: Box, occupied: readonly Box[]): BoardPoint {
  const { w, h } = source
  const neighbours: BoardPoint[] = [
    { x: source.x + w + GAP, y: source.y },
    { x: source.x, y: source.y + h + GAP },
    { x: source.x - w - GAP, y: source.y },
    { x: source.x, y: source.y - h - GAP }
  ]
  const free = neighbours.find((p) => boardBoxIsFree({ ...p, w, h }, occupied))
  if (free) {
    return free
  }
  const region = {
    x: source.x - SEARCH_COLUMNS * (w + GAP),
    y: source.y - SEARCH_ROWS * (h + GAP),
    w: (2 * SEARCH_COLUMNS + 1) * (w + GAP),
    h: (2 * SEARCH_ROWS + 1) * (h + GAP)
  }
  const center = boardFreeSpawnCenter(region, { w, h }, occupied, {
    x: source.x + w / 2,
    y: source.y + h / 2
  })
  return { x: center.x - w / 2, y: center.y - h / 2 }
}

/** "Claude 2" when "Claude 1" exists: the first unused `<label> <n>`. */
export function nextConsoleTitle(label: string, taken: readonly string[]): string {
  const used = new Set(taken.map((t) => t.toLowerCase()))
  let n = 1
  while (used.has(`${label} ${n}`.toLowerCase())) {
    n += 1
  }
  return `${label} ${n}`
}

/**
 * A plain (non-console) card's copy: same content, placed beside the source on
 * free canvas (never stacked on it), titled "<title> copy".
 */
export function duplicateCardDraft(card: BoardCard, occupied: readonly Box[]): NewBoardCard {
  const { id: _id, z: _z, ...rest } = card
  const title = card.title
    ? translate('board.card.copyTitle', '{{title}} copy', { title: card.title })
    : card.title
  return { ...rest, ...duplicateSpot(card, occupied), title } as NewBoardCard
}
