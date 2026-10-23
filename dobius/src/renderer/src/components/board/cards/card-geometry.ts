// Pure world-space math for dragging and resizing board cards. Cards live in
// world coordinates; pointers report screen pixels, so every delta is divided
// by the canvas zoom before it touches a card.

export type Rect = { x: number; y: number; w: number; h: number }
export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
export type MinSize = { w: number; h: number }

export const RESIZE_HANDLES: readonly ResizeHandle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']
export const DEFAULT_MIN_SIZE: MinSize = { w: 140, h: 80 }

export function screenDeltaToWorld(
  dx: number,
  dy: number,
  zoom: number
): { dx: number; dy: number } {
  const z = zoom > 0 ? zoom : 1
  return { dx: dx / z, dy: dy / z }
}

// Why: when the min size stops a shrink, the edge opposite the handle must stay
// put, so the dragged edge is the one that gets clamped, not the anchor.
export function resizeRect(
  start: Rect,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  min: MinSize = DEFAULT_MIN_SIZE
): Rect {
  let { x, y, w, h } = start
  if (handle.includes('e')) {
    w = Math.max(min.w, start.w + dx)
  }
  if (handle.includes('w')) {
    w = Math.max(min.w, start.w - dx)
    x = start.x + start.w - w
  }
  if (handle.includes('s')) {
    h = Math.max(min.h, start.h + dy)
  }
  if (handle.includes('n')) {
    h = Math.max(min.h, start.h - dy)
    y = start.y + start.h - h
  }
  return { x, y, w, h }
}

export function boundsOf(rects: readonly Rect[], padding = 0): Rect | null {
  if (rects.length === 0) {
    return null
  }
  const minX = Math.min(...rects.map((r) => r.x))
  const minY = Math.min(...rects.map((r) => r.y))
  const maxX = Math.max(...rects.map((r) => r.x + r.w))
  const maxY = Math.max(...rects.map((r) => r.y + r.h))
  return {
    x: minX - padding,
    y: minY - padding,
    w: maxX - minX + padding * 2,
    h: maxY - minY + padding * 2
  }
}

export function handleCursor(handle: ResizeHandle): string {
  if (handle === 'n' || handle === 's') {
    return 'ns-resize'
  }
  if (handle === 'e' || handle === 'w') {
    return 'ew-resize'
  }
  return handle === 'ne' || handle === 'sw' ? 'nesw-resize' : 'nwse-resize'
}

/**
 * Moves `rect` inside `area` (both world space), top-left winning when it is
 * larger, so a new card's title bar is never under the top bar or off-screen.
 */
export function clampRectIntoArea(rect: Rect, area: Rect): Rect {
  const x = Math.max(area.x, Math.min(rect.x, area.x + area.w - rect.w))
  const y = Math.max(area.y, Math.min(rect.y, area.y + area.h - rect.h))
  return { ...rect, x, y }
}
