// Pure zoom -> render decisions for a console card. The terminal grid (cols x
// rows) never follows board zoom. With a per-pane font override, the host is
// counter-scaled to 1:1 pixels and the font scales with zoom, so the same grid
// renders crisply. Without one, the host keeps the card's own size and the
// canvas scales its bitmap (grid still constant; text softer, and mouse
// selection is only exact at zoom 1).

export const CONSOLE_SETTLE_MS = 150
// Why: below this on-screen glyph size a scaled-down terminal is unreadable,
// so the card shows a text glance instead. Hysteresis (enter < exit) keeps a
// zoom hovering at the line from thrashing; each switch re-portals the pane.
export const GLANCE_ENTER_FONT_PX = 6
export const GLANCE_EXIT_FONT_PX = 6.75
/** On-screen body (px) below which even a readable font shows too little terminal. */
export const GLANCE_ENTER_BODY_PX = { w: 220, h: 120 }
const GLANCE_EXIT_BODY_FACTOR = 1.1
const FONT_STEP = 0.5

/** live = the borrowed TerminalPane; glance = status + output tail as plain text. */
export type ConsoleRenderMode = 'live' | 'glance'

export function nextConsoleMode(input: {
  prev: ConsoleRenderMode
  settledZoom: number
  visible: boolean
  gesturing: boolean
  baseFontSize: number
  /** Card body in world px; 0 while unmeasured (size is then ignored). */
  bodyWidth: number
  bodyHeight: number
}): ConsoleRenderMode {
  // Why: never swap mid-gesture; the card just scales visually until it settles.
  if (input.gesturing) {
    return input.prev
  }
  if (!input.visible) {
    return 'glance'
  }
  const z = input.settledZoom > 0 ? input.settledZoom : 1
  const leaving = input.prev === 'glance'
  const minFont = leaving ? GLANCE_EXIT_FONT_PX : GLANCE_ENTER_FONT_PX
  const bodyFactor = leaving ? GLANCE_EXIT_BODY_FACTOR : 1
  const tooSmall =
    input.bodyWidth > 0 &&
    input.bodyHeight > 0 &&
    (input.bodyWidth * z < GLANCE_ENTER_BODY_PX.w * bodyFactor ||
      input.bodyHeight * z < GLANCE_ENTER_BODY_PX.h * bodyFactor)
  return input.baseFontSize * z < minFont || tooSmall ? 'glance' : 'live'
}

/** Zoom at which the glance's screen-px text is drawn: counter-scaled, never enlarged past 1:1. */
export function glanceScale(settledZoom: number): number {
  return settledZoom > 0 ? Math.min(settledZoom, 1) : 1
}

/** Font that keeps the grid constant at this zoom (rounded so tiny zoom steps don't re-raster). */
export function zoomedFontSize(baseFontSize: number, settledZoom: number): number {
  const z = settledZoom > 0 ? settledZoom : 1
  return Math.max(1, Math.round((baseFontSize * z) / FONT_STEP) * FONT_STEP)
}

/** Host box (layout px) and the scale that maps it back onto the card. */
export function consoleHostBox(
  bodyWidth: number,
  bodyHeight: number,
  settledZoom: number,
  fontOverride: boolean
): { width: number; height: number; scale: number } {
  const z = settledZoom > 0 && fontOverride ? settledZoom : 1
  return { width: bodyWidth * z, height: bodyHeight * z, scale: 1 / z }
}

/**
 * Terminal grid size the host offers xterm, in cell units of the base font.
 * Constant across zoom in both modes: that is the invariant this module exists for.
 */
export function consoleGridPixels(
  bodyWidth: number,
  bodyHeight: number,
  settledZoom: number,
  baseFontSize: number,
  fontOverride: boolean
): { width: number; height: number } {
  const host = consoleHostBox(bodyWidth, bodyHeight, settledZoom, fontOverride)
  const font = fontOverride ? zoomedFontSize(baseFontSize, settledZoom) : baseFontSize
  return { width: (host.width / font) * baseFontSize, height: (host.height / font) * baseFontSize }
}

/** Refit only when live, settled, and something that affects the grid changed. */
export function shouldRefit(input: {
  mode: ConsoleRenderMode
  gesturing: boolean
  changed: boolean
}): boolean {
  return input.mode === 'live' && !input.gesturing && input.changed
}
