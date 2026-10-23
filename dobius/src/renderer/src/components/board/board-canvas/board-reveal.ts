import type { BoardViewport } from './board-viewport'

type Box = { x: number; y: number; w: number; h: number }
export type BoardInsets = { left: number; top: number; right: number; bottom: number }

/** Screen px the rails, top bar and collapsed command bar cover. */
export const BOARD_CHROME_INSETS: BoardInsets = { left: 96, top: 72, right: 80, bottom: 170 }

function shiftInto(start: number, size: number, min: number, max: number): number {
  if (start < min || size > max - min) {
    return min - start
  }
  if (start + size > max) {
    return max - (start + size)
  }
  return 0
}

/**
 * The smallest pan (same zoom) that brings `rect` (world) fully inside the
 * screen area not covered by board chrome; the same viewport when it already
 * is. Why: a new card placed where the free-spot scan falls back (right of the
 * rightmost card when the view is full) would otherwise land off-screen.
 */
export function revealRectViewport(
  viewport: BoardViewport,
  rect: Box,
  screen: { w: number; h: number },
  insets: BoardInsets = BOARD_CHROME_INSETS
): BoardViewport {
  const { zoom } = viewport
  const dx = shiftInto(
    rect.x * zoom + viewport.x,
    rect.w * zoom,
    insets.left,
    screen.w - insets.right
  )
  const dy = shiftInto(
    rect.y * zoom + viewport.y,
    rect.h * zoom,
    insets.top,
    screen.h - insets.bottom
  )
  return dx === 0 && dy === 0 ? viewport : { ...viewport, x: viewport.x + dx, y: viewport.y + dy }
}
