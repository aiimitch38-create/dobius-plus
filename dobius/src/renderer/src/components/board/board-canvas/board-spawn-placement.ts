import type { BoardPoint } from './board-viewport'

export const BOARD_CONSOLE_SIZE = { w: 640, h: 400 }
const GAP = 32

/**
 * Top-left world positions for `count` new consoles, two per row, with the
 * block centered on `center` so "Spawn 4" lands as a 2x2 grid where you look.
 */
export function boardSpawnPlacements(
  center: BoardPoint,
  count: number,
  size: { w: number; h: number } = BOARD_CONSOLE_SIZE
): BoardPoint[] {
  const n = Math.max(0, Math.floor(count))
  const columns = Math.min(2, n)
  const rows = Math.ceil(n / 2)
  const blockW = columns * size.w + Math.max(0, columns - 1) * GAP
  const blockH = rows * size.h + Math.max(0, rows - 1) * GAP
  const left = center.x - blockW / 2
  const top = center.y - blockH / 2
  return Array.from({ length: n }, (_, i) => ({
    x: left + (i % 2) * (size.w + GAP),
    y: top + Math.floor(i / 2) * (size.h + GAP)
  }))
}

type Box = { x: number; y: number; w: number; h: number }

const SCAN_STEP = 40
const CLEARANCE = 24

/** Size of the block `boardSpawnPlacements` lays out for `count` consoles. */
export function boardSpawnBlockSize(
  count: number,
  size: { w: number; h: number } = BOARD_CONSOLE_SIZE
): { w: number; h: number } {
  const n = Math.max(1, Math.floor(count))
  const columns = Math.min(2, n)
  const rows = Math.ceil(n / 2)
  return { w: columns * size.w + (columns - 1) * GAP, h: rows * size.h + (rows - 1) * GAP }
}

function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.w + CLEARANCE &&
    b.x < a.x + a.w + CLEARANCE &&
    a.y < b.y + b.h + CLEARANCE &&
    b.y < a.y + a.h + CLEARANCE
  )
}

/** True when `box` clears every occupied box by the shared clearance. */
export function boardBoxIsFree(box: Box, occupied: readonly Box[]): boolean {
  return !occupied.some((o) => overlaps(box, o))
}

/**
 * Center for a new spawn block: the first spot (scanning rows top-left to
 * bottom-right) inside the visible world area that clears every card, or with
 * `near`, the clear spot whose center is closest to it. When the area is full
 * it goes just right of the rightmost card, so a spawn never lands hidden under
 * the command bar or on top of other consoles.
 */
export function boardFreeSpawnCenter(
  visible: Box,
  block: { w: number; h: number },
  occupied: readonly Box[],
  near?: BoardPoint
): BoardPoint {
  let best: BoardPoint | null = null
  let bestDistance = Infinity
  for (let y = visible.y; y + block.h <= visible.y + visible.h; y += SCAN_STEP) {
    for (let x = visible.x; x + block.w <= visible.x + visible.w; x += SCAN_STEP) {
      if (!boardBoxIsFree({ x, y, w: block.w, h: block.h }, occupied)) {
        continue
      }
      const center = { x: x + block.w / 2, y: y + block.h / 2 }
      if (!near) {
        return center
      }
      const distance = Math.hypot(center.x - near.x, center.y - near.y)
      if (distance < bestDistance) {
        best = center
        bestDistance = distance
      }
    }
  }
  if (best) {
    return best
  }
  if (occupied.length === 0) {
    return { x: visible.x + visible.w / 2, y: visible.y + block.h / 2 }
  }
  const right = Math.max(...occupied.map((o) => o.x + o.w))
  return { x: right + GAP * 2 + block.w / 2, y: visible.y + block.h / 2 }
}
