// Guest CSS px (inside a web tile) → Board screen px, and off-screen hints.
// The webview's bounding rect already includes the Board zoom and any device
// scale, so one ratio (rect.width / webview.clientWidth) maps both axes.
import type { AgentCursorTarget } from '../../../../../shared/agent-cursor'

export type RectLike = { left: number; top: number; width: number; height: number }
export type ScreenRect = { x: number; y: number; w: number; h: number }
export type ScreenPoint = { x: number; y: number }

export const WEB_TILE_ID_ATTRIBUTE = 'data-board-web-tile-id'
export const OFFSCREEN_HINT_INSET_PX = 16

export function guestToScreen(
  target: { x: number; y: number; w?: number; h?: number },
  rect: RectLike,
  guestWidth: number
): ScreenRect {
  const scale = guestWidth > 0 && rect.width > 0 ? rect.width / guestWidth : 1
  return {
    x: rect.left + target.x * scale,
    y: rect.top + target.y * scale,
    w: (target.w ?? 0) * scale,
    h: (target.h ?? 0) * scale
  }
}

export function findWebTileWebview(tileId: string): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null
  }
  const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(tileId) : tileId
  return document.querySelector<HTMLElement>(`[${WEB_TILE_ID_ATTRIBUTE}="${escaped}"] webview`)
}

/** Screen rect for a target, or null while its tile is not mounted. */
export function projectAgentTarget(
  target: AgentCursorTarget,
  point: { x: number; y: number } = target
): ScreenRect | null {
  if ('window' in target) {
    return { x: point.x, y: point.y, w: target.w ?? 0, h: target.h ?? 0 }
  }
  const webview = findWebTileWebview(target.tileId)
  if (!webview) {
    return null
  }
  return guestToScreen(
    { x: point.x, y: point.y, w: target.w, h: target.h },
    webview.getBoundingClientRect(),
    webview.clientWidth
  )
}

export type EdgeHint = ScreenPoint & { angleDeg: number; offscreen: boolean }

/** Clamps a point to the bounds' inner edge and gives the direction it lies in. */
export function clampToEdge(
  point: ScreenPoint,
  bounds: RectLike,
  inset = OFFSCREEN_HINT_INSET_PX
): EdgeHint {
  const minX = bounds.left + inset
  const maxX = bounds.left + bounds.width - inset
  const minY = bounds.top + inset
  const maxY = bounds.top + bounds.height - inset
  const x = Math.min(maxX, Math.max(minX, point.x))
  const y = Math.min(maxY, Math.max(minY, point.y))
  const offscreen = x !== point.x || y !== point.y
  const angleDeg = offscreen ? (Math.atan2(point.y - y, point.x - x) * 180) / Math.PI : 0
  return { x, y, angleDeg, offscreen }
}
