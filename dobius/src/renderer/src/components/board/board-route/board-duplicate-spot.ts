import { boardFreeSpawnCenter } from '../board-canvas/board-spawn-placement'
import type { BoardPoint } from '../board-canvas/board-viewport'

type Box = { x: number; y: number; w: number; h: number }

const GAP = 32
// How far right and down a duplicate may look for room before the shared
// placement's own fallback (just right of the rightmost card) takes over.
const SEARCH_COLUMNS = 3
const SEARCH_ROWS = 3

/**
 * Top-left for a copy of `source`, same size, beside it: the shared free-spot
 * scan over the area starting just right of the source, so the first try is
 * directly to its right and the copy never covers another card.
 */
export function duplicateSpot(source: Box, occupied: readonly Box[]): BoardPoint {
  const block = { w: source.w, h: source.h }
  const region = {
    x: source.x + source.w + GAP,
    y: source.y,
    w: SEARCH_COLUMNS * (source.w + GAP),
    h: SEARCH_ROWS * (source.h + GAP)
  }
  const center = boardFreeSpawnCenter(region, block, occupied)
  return { x: center.x - block.w / 2, y: center.y - block.h / 2 }
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
