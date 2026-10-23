import {
  BOARD_MAX_ZOOM,
  BOARD_MIN_ZOOM,
  EMPTY_BOARD,
  type BoardViewport
} from '@/store/slices/board-state'

// Viewport model for the Board canvas, shared with the board store. `x`/`y` are
// the screen position (px, relative to the canvas) of the world origin; `zoom`
// scales world units: screen = world * zoom + offset, one CSS transform.
export type { BoardViewport } from '@/store/slices/board-state'
export { BOARD_MAX_ZOOM, BOARD_MIN_ZOOM } from '@/store/slices/board-state'
export type BoardPoint = { x: number; y: number }
export type BoardSize = { width: number; height: number }
export type BoardRect = { x: number; y: number; width: number; height: number }

export const BOARD_DEFAULT_VIEWPORT: BoardViewport = EMPTY_BOARD.viewport
// Per Cmd +/- press, and per pixel of pinch/ctrl-wheel delta.
export const BOARD_ZOOM_STEP = 1.2
const WHEEL_ZOOM_SENSITIVITY = 0.01
// Measured: the reference spaces dots ~57px apart at 63% zoom (≈90 world px).
const DOT_GRID_BASE_SPACING = 90

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) {
    return 1
  }
  return Math.min(BOARD_MAX_ZOOM, Math.max(BOARD_MIN_ZOOM, zoom))
}

export function screenToWorld(point: BoardPoint, viewport: BoardViewport): BoardPoint {
  return {
    x: (point.x - viewport.x) / viewport.zoom,
    y: (point.y - viewport.y) / viewport.zoom
  }
}

export function worldToScreen(point: BoardPoint, viewport: BoardViewport): BoardPoint {
  return {
    x: point.x * viewport.zoom + viewport.x,
    y: point.y * viewport.zoom + viewport.y
  }
}

export function panViewport(viewport: BoardViewport, dx: number, dy: number): BoardViewport {
  return { ...viewport, x: viewport.x + dx, y: viewport.y + dy }
}

/** Zooms to `nextZoom` while keeping the world point under `anchor` (screen px) fixed. */
export function zoomViewportAtPoint(
  viewport: BoardViewport,
  nextZoom: number,
  anchor: BoardPoint
): BoardViewport {
  const zoom = clampZoom(nextZoom)
  const world = screenToWorld(anchor, viewport)
  return { zoom, x: anchor.x - world.x * zoom, y: anchor.y - world.y * zoom }
}

export function zoomViewportBy(
  viewport: BoardViewport,
  factor: number,
  anchor: BoardPoint
): BoardViewport {
  return zoomViewportAtPoint(viewport, viewport.zoom * factor, anchor)
}

/** Pinch gestures arrive as ctrl+wheel with small fractional deltas; exp keeps zoom symmetric. */
export function wheelDeltaToZoomFactor(deltaY: number): number {
  return Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)
}

export function boundsOfRects(rects: readonly BoardRect[]): BoardRect | null {
  if (rects.length === 0) {
    return null
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const rect of rects) {
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
    maxX = Math.max(maxX, rect.x + rect.width)
    maxY = Math.max(maxY, rect.y + rect.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Centers all rects in `size` with `padding` px of breathing room. Never zooms
 * past 100% so fitting a single small card doesn't blow it up.
 */
export function fitViewportToRects(
  rects: readonly BoardRect[],
  size: BoardSize,
  padding = 96
): BoardViewport {
  const bounds = boundsOfRects(rects)
  if (!bounds || size.width <= 0 || size.height <= 0) {
    return { ...BOARD_DEFAULT_VIEWPORT, x: size.width / 2, y: size.height / 2 }
  }
  const availableWidth = Math.max(1, size.width - padding * 2)
  const availableHeight = Math.max(1, size.height - padding * 2)
  const zoom = clampZoom(
    Math.min(
      1,
      availableWidth / Math.max(1, bounds.width),
      availableHeight / Math.max(1, bounds.height)
    )
  )
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  return { zoom, x: size.width / 2 - centerX * zoom, y: size.height / 2 - centerY * zoom }
}

/**
 * Screen-space dot spacing. Doubles/halves the world spacing so dots stay
 * between 45 and 90 px apart at any zoom instead of turning into noise.
 */
export function dotGridSpacing(zoom: number): number {
  let spacing = DOT_GRID_BASE_SPACING * clampZoom(zoom)
  while (spacing < 45) {
    spacing *= 2
  }
  while (spacing > 90) {
    spacing /= 2
  }
  return spacing
}

// Clear band between the top bar and the command bar that Fit view frames into.
const FIT_TOP_INSET = 64
const FIT_BOTTOM_INSET = 170

/** Fit view for the Board: frames rects above the command bar, below the top bar. */
export function fitBoardViewport(rects: readonly BoardRect[], size: BoardSize): BoardViewport {
  const fitted = fitViewportToRects(rects, {
    width: size.width,
    height: Math.max(1, size.height - FIT_TOP_INSET - FIT_BOTTOM_INSET)
  })
  return { ...fitted, y: fitted.y + FIT_TOP_INSET }
}
