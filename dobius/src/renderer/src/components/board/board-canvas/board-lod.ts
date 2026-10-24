// Shared level-of-detail rule for board cards whose live content breaks when
// the board scales it down (xterm canvases, Electron <webview> guests). Plain
// DOM cards (notes, lists, kanban, calendar, markdown) never need this: the
// browser re-rasters them at the zoomed size, so they are already a faithful
// miniature of themselves.

/** full = the live content; glance = a static miniature laid over it (live content stays mounted). */
export type BoardLod = 'full' | 'glance'

/** A zoom that changed within this window is an active pinch/scroll-zoom. */
export const BOARD_LOD_SETTLE_MS = 150
// Why: below ~6px on screen, live text is unreadable; hysteresis (enter < exit)
// keeps a zoom hovering at the line from thrashing between modes.
export const LOD_ENTER_TEXT_PX = 6
export const LOD_EXIT_TEXT_PX = 6.75
const LOD_EXIT_BODY_FACTOR = 1.1
/** On-screen body height (px) below which even a miniature is noise; the title bar carries the card. */
export const LOD_MIN_MINIATURE_PX = 60

export type BoardLodInput = {
  prev: BoardLod
  settledZoom: number
  visible: boolean
  gesturing: boolean
  /** The content's own text size in world px (e.g. terminal font size). */
  textPx: number
  /** Card body in world px; 0 while unmeasured (size is then ignored). */
  bodyWidth: number
  bodyHeight: number
  /** On-screen body (px) below which the live content shows too little to be useful. */
  minBody?: { w: number; h: number }
}

export function nextBoardLod(input: BoardLodInput): BoardLod {
  // Why: never swap mid-gesture; the card just scales visually until it settles.
  if (input.gesturing) {
    return input.prev
  }
  if (!input.visible) {
    return 'glance'
  }
  const z = input.settledZoom > 0 ? input.settledZoom : 1
  const leaving = input.prev === 'glance'
  const minText = leaving ? LOD_EXIT_TEXT_PX : LOD_ENTER_TEXT_PX
  const bodyFactor = leaving ? LOD_EXIT_BODY_FACTOR : 1
  const min = input.minBody
  const tooSmall =
    min !== undefined &&
    input.bodyWidth > 0 &&
    input.bodyHeight > 0 &&
    (input.bodyWidth * z < min.w * bodyFactor || input.bodyHeight * z < min.h * bodyFactor)
  return input.textPx * z < minText || tooSmall ? 'glance' : 'full'
}

/** Whether a glance miniature is worth drawing at all at this on-screen size. */
export function miniatureWorthDrawing(bodyHeight: number, settledZoom: number): boolean {
  const z = settledZoom > 0 ? settledZoom : 1
  // Unmeasured bodies draw: a frame-only card would flash empty on first paint.
  return bodyHeight <= 0 || bodyHeight * z >= LOD_MIN_MINIATURE_PX
}
