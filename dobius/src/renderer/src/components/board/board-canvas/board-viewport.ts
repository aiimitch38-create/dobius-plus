import {
  BOARD_MAX_ZOOM,
  BOARD_MIN_ZOOM,
  EMPTY_BOARD,
  type BoardViewport
} from '@/store/slices/board-state'
import { BOARD_CHROME_INSETS, type BoardInsets } from './board-reveal'

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

// Why: a mouse-wheel notch with Ctrl reports ~100px (or 3 "lines"), which at
// 0.01/px jumped 2.7x per notch (300% -> 10% in three notches). Capping each
// event keeps one notch at most one button step; pinch deltas are tiny and pass.
const WHEEL_ZOOM_MAX_DELTA_PX = Math.log(BOARD_ZOOM_STEP) / WHEEL_ZOOM_SENSITIVITY
const WHEEL_LINE_PX = 16
const WHEEL_PAGE_PX = 800

/**
 * Pinch gestures arrive as ctrl+wheel with small fractional deltas; exp keeps
 * zoom symmetric. `deltaMode` 1 = lines, 2 = pages (WheelEvent constants).
 */
export function wheelDeltaToZoomFactor(deltaY: number, deltaMode = 0): number {
  const px =
    deltaMode === 1 ? deltaY * WHEEL_LINE_PX : deltaMode === 2 ? deltaY * WHEEL_PAGE_PX : deltaY
  const capped = Math.max(-WHEEL_ZOOM_MAX_DELTA_PX, Math.min(WHEEL_ZOOM_MAX_DELTA_PX, px))
  return Math.exp(-capped * WHEEL_ZOOM_SENSITIVITY)
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

/** Screen rect not covered by rails, top bar, chips and the command bar. */
export function boardSafeArea(
  size: BoardSize,
  insets: BoardInsets = BOARD_CHROME_INSETS
): BoardRect {
  return {
    x: insets.left,
    y: insets.top,
    width: Math.max(1, size.width - insets.left - insets.right),
    height: Math.max(1, size.height - insets.top - insets.bottom)
  }
}

export type BoardCameraFitOptions = {
  insets?: BoardInsets
  padding?: number
  minZoom?: number
  maxZoom?: number
}

/**
 * Frames `rects` inside the safe area with `padding`. Zoom is the fitting zoom
 * clamped to [minZoom, maxZoom]; when minZoom forces the content to overflow,
 * its top-left (the title bar) is pinned into the safe area instead of centering.
 */
export function boardCameraFit(
  rects: readonly BoardRect[],
  size: BoardSize,
  {
    insets = BOARD_CHROME_INSETS,
    padding = 96,
    minZoom = 0,
    maxZoom = 1
  }: BoardCameraFitOptions = {}
): BoardViewport {
  const safe = boardSafeArea(size, insets)
  const bounds = boundsOfRects(rects)
  if (!bounds) {
    return { zoom: 1, x: safe.x + safe.width / 2, y: safe.y + safe.height / 2 }
  }
  const pad = Math.min(padding, safe.width / 4, safe.height / 4)
  const availW = Math.max(1, safe.width - pad * 2)
  const availH = Math.max(1, safe.height - pad * 2)
  const fit = Math.min(availW / Math.max(1, bounds.width), availH / Math.max(1, bounds.height))
  const zoom = clampZoom(Math.max(minZoom, Math.min(maxZoom, fit)))
  const axis = (start: number, extent: number, areaStart: number, area: number): number => {
    const screenExtent = extent * zoom
    if (screenExtent <= area - pad * 2 + 0.5) {
      return areaStart + area / 2 - (start + extent / 2) * zoom
    }
    return areaStart + pad - start * zoom
  }
  return {
    zoom,
    x: axis(bounds.x, bounds.width, safe.x, safe.width),
    y: axis(bounds.y, bounds.height, safe.y, safe.height)
  }
}

const FIT_VIEW_PADDING = 48

/** Fit view for the Board: frames every card inside the safe area, never past 100%. */
export function fitBoardViewport(
  rects: readonly BoardRect[],
  size: BoardSize,
  insets: BoardInsets = BOARD_CHROME_INSETS
): BoardViewport {
  return boardCameraFit(rects, size, { insets, padding: FIT_VIEW_PADDING, maxZoom: 1 })
}
