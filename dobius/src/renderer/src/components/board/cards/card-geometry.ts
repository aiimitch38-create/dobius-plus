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

/** On-screen thickness (px) of a resize hit zone, at every zoom. */
export const RESIZE_HANDLE_SCREEN_PX = 10
/**
 * Most a hit zone may reach into the card, in world px. The title text starts
 * ~13px below the top edge (40px bar, centred 14px text), so a top-edge zone
 * capped here never sits over it however far the board is zoomed out.
 */
export const RESIZE_HANDLE_MAX_INSET = 8
/** Edge strips stop this far (world px) short of the corners. */
const EDGE_STRIP_INSET = 8

export type ResizeHandleBox = {
  left?: number
  right?: number
  top?: number
  bottom?: number
  width?: number
  height?: number
}

/**
 * Card-relative box (world px) of one resize hit zone: a constant
 * RESIZE_HANDLE_SCREEN_PX on screen, centred on the edge while that reaches no
 * more than RESIZE_HANDLE_MAX_INSET into the card, pushed outward once it would.
 * At low zoom a centred zone grew past the title bar, so a title click resized.
 */
export function resizeHandleBox(handle: ResizeHandle, zoom: number): ResizeHandleBox {
  const size = RESIZE_HANDLE_SCREEN_PX / (zoom > 0 ? zoom : 1)
  const inward = Math.min(size / 2, RESIZE_HANDLE_MAX_INSET)
  const outside = -(size - inward)
  switch (handle) {
    case 'n':
      return { left: EDGE_STRIP_INSET, right: EDGE_STRIP_INSET, top: outside, height: size }
    case 's':
      return { left: EDGE_STRIP_INSET, right: EDGE_STRIP_INSET, bottom: outside, height: size }
    case 'e':
      return { top: EDGE_STRIP_INSET, bottom: EDGE_STRIP_INSET, right: outside, width: size }
    case 'w':
      return { top: EDGE_STRIP_INSET, bottom: EDGE_STRIP_INSET, left: outside, width: size }
    case 'ne':
      return { right: outside, top: outside, width: size, height: size }
    case 'nw':
      return { left: outside, top: outside, width: size, height: size }
    case 'se':
      return { right: outside, bottom: outside, width: size, height: size }
    case 'sw':
      return { left: outside, bottom: outside, width: size, height: size }
  }
}
