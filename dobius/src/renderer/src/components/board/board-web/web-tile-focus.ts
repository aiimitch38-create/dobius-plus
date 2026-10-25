import type { BoardViewport } from '@/store/slices/board'
import type { BoardSize } from '../board-canvas/board-viewport'

/** Below this zoom a live page is too small to be "already readable"; focusing it should fly. */
export const WEB_TILE_VISIBLE_MIN_ZOOM = 0.75

/**
 * True when the whole tile is already inside the screen at a readable zoom:
 * a click into such a page must not move the camera (the user is working in
 * it, maybe mid-press). Only tiles partly off screen or too small fly.
 */
export function webTileFullyVisible(
  rect: { x: number; y: number; w: number; h: number },
  viewport: BoardViewport,
  screen: BoardSize,
  minZoom: number = WEB_TILE_VISIBLE_MIN_ZOOM
): boolean {
  if (viewport.zoom < minZoom) {
    return false
  }
  const left = rect.x * viewport.zoom + viewport.x
  const top = rect.y * viewport.zoom + viewport.y
  const right = left + rect.w * viewport.zoom
  const bottom = top + rect.h * viewport.zoom
  return left >= 0 && top >= 0 && right <= screen.width && bottom <= screen.height
}
