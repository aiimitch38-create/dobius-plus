import { BOARD_CHROME_INSETS, revealRectViewport, type BoardInsets } from './board-reveal'
import {
  BOARD_MAX_ZOOM,
  boardCameraFit,
  type BoardRect,
  type BoardSize,
  type BoardViewport
} from './board-viewport'

export { boardCameraFit, boardSafeArea, type BoardCameraFitOptions } from './board-viewport'

// One camera for every "fly to" on the Board: click-to-focus, ⌥←/→, N, the
// needs-you pill, Mission Map Focus and Fit view all frame through here.

export const BOARD_CAMERA_DURATION_MS = 280
export const BOARD_FOCUS_PADDING = 32
/** Smallest on-screen terminal font a focused console may show. */
export const BOARD_FOCUS_MIN_TEXT_PX = 13

/** Zoom floor for a focused console: at least 100% and readable terminal text. */
export function boardFocusMinZoom(terminalFontSize: number): number {
  const font = terminalFontSize > 0 ? terminalFontSize : 14
  return Math.max(1, BOARD_FOCUS_MIN_TEXT_PX / font)
}

/** Viewport that fills the safe area with one card (click-to-focus). */
export function boardFocusViewport(
  rect: BoardRect,
  size: BoardSize,
  terminalFontSize: number,
  insets: BoardInsets = BOARD_CHROME_INSETS
): BoardViewport {
  return boardCameraFit([rect], size, {
    insets,
    padding: BOARD_FOCUS_PADDING,
    minZoom: boardFocusMinZoom(terminalFontSize),
    maxZoom: BOARD_MAX_ZOOM
  })
}

/** Ceiling for a focused non-console card: a small note lands readable, not poster-sized. */
export const BOARD_FOCUS_CARD_MAX_ZOOM = 2
/** Padding around a focused group frame, matching Mission Map's group fit. */
export const BOARD_FOCUS_GROUP_PADDING = 48

/** How focus mode frames one kind of card. */
export type BoardFocusFraming = 'console' | 'text' | 'fit'

/**
 * Consoles keep readable terminal text; text-bearing cards land at 100% or
 * more; images, web tiles, shapes and ink always fit whole.
 */
export function boardFocusFramingFor(kind: string): BoardFocusFraming {
  switch (kind) {
    case 'console':
      return 'console'
    case 'web':
    case 'image':
    case 'shape':
    case 'stroke':
      return 'fit'
    default:
      return 'text'
  }
}

/** Viewport that frames one card of `kind` in the safe area (click-to-focus). */
export function boardFocusCardViewport(
  kind: string,
  rect: BoardRect,
  size: BoardSize,
  terminalFontSize: number,
  insets: BoardInsets = BOARD_CHROME_INSETS
): BoardViewport {
  const framing = boardFocusFramingFor(kind)
  if (framing === 'console') {
    return boardFocusViewport(rect, size, terminalFontSize, insets)
  }
  return boardCameraFit([rect], size, {
    insets,
    padding: BOARD_FOCUS_PADDING,
    // Why: the cards' body text is ~13px at 100%, so 100% is the readable floor.
    minZoom: framing === 'text' ? 1 : 0,
    maxZoom: BOARD_FOCUS_CARD_MAX_ZOOM
  })
}

/** Viewport that fits several cards (a group frame, a Mission Map node) at up to 100%. */
export function boardFocusGroupViewport(
  rects: readonly BoardRect[],
  size: BoardSize,
  insets: BoardInsets = BOARD_CHROME_INSETS
): BoardViewport {
  return boardCameraFit(rects, size, { insets, padding: BOARD_FOCUS_GROUP_PADDING, maxZoom: 1 })
}

/**
 * Shows a just-placed block (world rect) whole inside the safe area: the
 * smallest pan when it fits at the current zoom, otherwise zoomed out just
 * enough to fit. Never zooms in. Returns `viewport` itself when nothing moves.
 */
export function boardRevealBlockViewport(
  viewport: BoardViewport,
  rect: { x: number; y: number; w: number; h: number },
  screen: BoardSize,
  insets: BoardInsets = BOARD_CHROME_INSETS
): BoardViewport {
  const safeW = screen.width - insets.left - insets.right
  const safeH = screen.height - insets.top - insets.bottom
  if (rect.w * viewport.zoom <= safeW && rect.h * viewport.zoom <= safeH) {
    return revealRectViewport(viewport, rect, { w: screen.width, h: screen.height }, insets)
  }
  return boardCameraFit([{ x: rect.x, y: rect.y, width: rect.w, height: rect.h }], screen, {
    insets,
    padding: 0,
    maxZoom: viewport.zoom
  })
}

/** cubic-bezier(.2,.8,.2,1)-like ease-out. */
export function boardCameraEase(t: number): number {
  const c = Math.min(1, Math.max(0, t))
  return 1 - Math.pow(1 - c, 3)
}

/**
 * Viewport at progress `t` (0..1, already eased). Zoom moves geometrically and
 * the world point at the screen center moves linearly, so the camera glides
 * instead of swooping off to one side.
 */
export function interpolateViewport(
  from: BoardViewport,
  to: BoardViewport,
  t: number,
  center: { x: number; y: number }
): BoardViewport {
  if (t <= 0) {
    return from
  }
  if (t >= 1) {
    return to
  }
  const zoom = from.zoom * Math.pow(to.zoom / from.zoom, t)
  const fromWorld = { x: (center.x - from.x) / from.zoom, y: (center.y - from.y) / from.zoom }
  const toWorld = { x: (center.x - to.x) / to.zoom, y: (center.y - to.y) / to.zoom }
  const wx = fromWorld.x + (toWorld.x - fromWorld.x) * t
  const wy = fromWorld.y + (toWorld.y - fromWorld.y) * t
  return { zoom, x: center.x - wx * zoom, y: center.y - wy * zoom }
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
}

let cancelRunning: (() => void) | null = null

/**
 * Animates the viewport from `from` to `to` through `apply`, cancelling any
 * camera move already in flight. Reduced motion jumps straight there.
 * `onDone` runs once the target is applied (not when cancelled).
 */
export function animateBoardViewport(
  from: BoardViewport,
  to: BoardViewport,
  apply: (viewport: BoardViewport) => void,
  options: { size: BoardSize; durationMs?: number; onDone?: () => void }
): void {
  cancelRunning?.()
  cancelRunning = null
  const duration = options.durationMs ?? BOARD_CAMERA_DURATION_MS
  if (duration <= 0 || prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
    apply(to)
    options.onDone?.()
    return
  }
  const center = { x: options.size.width / 2, y: options.size.height / 2 }
  let frame = 0
  let start: number | null = null
  const step = (now: number): void => {
    start ??= now
    const t = (now - start) / duration
    apply(interpolateViewport(from, to, boardCameraEase(t), center))
    if (t < 1) {
      frame = requestAnimationFrame(step)
      return
    }
    cancelRunning = null
    options.onDone?.()
  }
  frame = requestAnimationFrame(step)
  cancelRunning = () => cancelAnimationFrame(frame)
}
