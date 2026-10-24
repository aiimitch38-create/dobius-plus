// Pure zoom -> render decisions for a console card. The terminal grid (cols x
// rows) never follows board zoom. With a per-pane font override, the host is
// counter-scaled to 1:1 pixels and the font scales with zoom, so the same grid
// renders crisply. Without one, the host keeps the card's own size and the
// canvas scales its bitmap (grid still constant; text softer, and mouse
// selection is only exact at zoom 1).

import {
  BOARD_LOD_SETTLE_MS,
  LOD_ENTER_TEXT_PX,
  LOD_EXIT_TEXT_PX,
  nextBoardLod
} from '../board-canvas/board-lod'

export const CONSOLE_SETTLE_MS = BOARD_LOD_SETTLE_MS
// Why: below this on-screen glyph size a scaled-down terminal is unreadable,
// so the card shows a miniature instead. Hysteresis (enter < exit) keeps a
// zoom hovering at the line from thrashing; each switch re-portals the pane.
export const GLANCE_ENTER_FONT_PX = LOD_ENTER_TEXT_PX
export const GLANCE_EXIT_FONT_PX = LOD_EXIT_TEXT_PX
/** On-screen body (px) below which even a readable font shows too little terminal. */
export const GLANCE_ENTER_BODY_PX = { w: 220, h: 120 }
const FONT_STEP = 0.5

/** live = the borrowed TerminalPane; glance = a static miniature of its screen. */
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
  const lod = nextBoardLod({
    prev: input.prev === 'live' ? 'full' : 'glance',
    settledZoom: input.settledZoom,
    visible: input.visible,
    gesturing: input.gesturing,
    textPx: input.baseFontSize,
    bodyWidth: input.bodyWidth,
    bodyHeight: input.bodyHeight,
    minBody: GLANCE_ENTER_BODY_PX
  })
  return lod === 'full' ? 'live' : 'glance'
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
