// Style chosen in the left-rail tool panels (Shapes, Text, Pen) and carried onto
// the cards those tools create. Pure: types, defaults, sanitizer, CSS resolvers.
// Colors are Board token names, or a #rrggbb picked with the eyedropper.
import type { BoardSwatch } from '@/store/slices/board'

export type BoardToolShape = 'rect' | 'ellipse' | 'diamond' | 'line' | 'arrow' | 'sticky'
export type BoardInkToken = 'text' | 'danger' | 'accent' | 'green' | 'blue' | 'purple'
export type BoardCustomColor = `#${string}`
export type BoardInkColor = BoardInkToken | BoardCustomColor
export type BoardFillColor = 'none' | BoardSwatch | BoardCustomColor
export type BoardStrokeWidth = 'thin' | 'medium' | 'bold'
export type BoardStrokeStyle = 'solid' | 'dashed' | 'dotted'
export type BoardSloppiness = 'architect' | 'artist' | 'cartoonist'
export type BoardEdges = 'sharp' | 'round'
export type BoardTextSize = 'small' | 'medium' | 'large' | 'xlarge'
export type BoardTextAlign = 'left' | 'center' | 'right'
export type BoardFillStyle = 'solid' | 'hachure' | 'cross-hatch'
export type BoardTextFont = 'sans' | 'rounded' | 'serif' | 'mono' | 'hand' | 'script'

/** Shared by shape, stroke and text cards; each reads only the fields it uses. */
export type BoardCardStyle = {
  stroke: BoardInkColor
  fill: BoardFillColor
  strokeWidth: BoardStrokeWidth
  strokeStyle: BoardStrokeStyle
  sloppiness: BoardSloppiness
  edges: BoardEdges
  /** 0..100 */
  opacity: number
  textSize: BoardTextSize
  textAlign: BoardTextAlign
  textFont: BoardTextFont
  fillStyle: BoardFillStyle
}

export const BOARD_TOOL_SHAPES: readonly BoardToolShape[] = [
  'rect',
  'ellipse',
  'diamond',
  'line',
  'arrow',
  'sticky'
]
export const BOARD_INK_TOKENS: readonly BoardInkToken[] = [
  'text',
  'danger',
  'green',
  'blue',
  'accent',
  'purple'
]
export const BOARD_FILL_OPTIONS: readonly ('none' | BoardSwatch)[] = [
  'none',
  'accent',
  'green',
  'blue',
  'yellow',
  'pink',
  'purple'
]
export const BOARD_STROKE_WIDTHS: readonly BoardStrokeWidth[] = ['thin', 'medium', 'bold']
export const BOARD_STROKE_STYLES: readonly BoardStrokeStyle[] = ['solid', 'dashed', 'dotted']
export const BOARD_SLOPPINESS: readonly BoardSloppiness[] = ['architect', 'artist', 'cartoonist']
export const BOARD_EDGES: readonly BoardEdges[] = ['sharp', 'round']
export const BOARD_TEXT_SIZES: readonly BoardTextSize[] = ['small', 'medium', 'large', 'xlarge']
export const BOARD_TEXT_ALIGNS: readonly BoardTextAlign[] = ['left', 'center', 'right']
export const BOARD_FILL_STYLES: readonly BoardFillStyle[] = ['solid', 'hachure', 'cross-hatch']
export const BOARD_TEXT_FONTS: readonly BoardTextFont[] = [
  'sans',
  'rounded',
  'serif',
  'mono',
  'hand',
  'script'
]

export const DEFAULT_BOARD_CARD_STYLE: BoardCardStyle = {
  stroke: 'text',
  fill: 'none',
  strokeWidth: 'medium',
  strokeStyle: 'solid',
  sloppiness: 'artist',
  edges: 'round',
  opacity: 100,
  textSize: 'medium',
  textAlign: 'left',
  textFont: 'sans',
  fillStyle: 'solid'
}

const SWATCHES: readonly BoardSwatch[] = ['yellow', 'pink', 'blue', 'green', 'purple', 'accent']
const HEX = /^#[0-9a-f]{6}$/i

export function isBoardCustomColor(value: unknown): value is BoardCustomColor {
  return typeof value === 'string' && HEX.test(value)
}

function pick<T extends string>(options: readonly T[], value: unknown, fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback
}

/** Fills every missing or invalid field from the defaults (safe for persisted data). */
export function sanitizeBoardCardStyle(raw: unknown): BoardCardStyle {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_BOARD_CARD_STYLE
  const opacity =
    typeof r.opacity === 'number' && Number.isFinite(r.opacity) ? r.opacity : d.opacity
  return {
    stroke: isBoardCustomColor(r.stroke) ? r.stroke : pick(BOARD_INK_TOKENS, r.stroke, d.stroke),
    fill: isBoardCustomColor(r.fill)
      ? r.fill
      : pick<BoardFillColor>(['none', ...SWATCHES], r.fill, d.fill),
    strokeWidth: pick(BOARD_STROKE_WIDTHS, r.strokeWidth, d.strokeWidth),
    strokeStyle: pick(BOARD_STROKE_STYLES, r.strokeStyle, d.strokeStyle),
    sloppiness: pick(BOARD_SLOPPINESS, r.sloppiness, d.sloppiness),
    edges: pick(BOARD_EDGES, r.edges, d.edges),
    opacity: Math.round(Math.min(100, Math.max(10, opacity))),
    textSize: pick(BOARD_TEXT_SIZES, r.textSize, d.textSize),
    textAlign: pick(BOARD_TEXT_ALIGNS, r.textAlign, d.textAlign),
    textFont: pick(BOARD_TEXT_FONTS, r.textFont, d.textFont),
    fillStyle: pick(BOARD_FILL_STYLES, r.fillStyle, d.fillStyle)
  }
}

export function boardInkCss(color: BoardInkColor): string {
  if (isBoardCustomColor(color)) {
    return color
  }
  switch (color) {
    case 'text':
      return 'var(--board-text)'
    case 'danger':
      return 'var(--board-danger-text)'
    case 'accent':
      return 'var(--board-accent)'
    default:
      // Why: swatch tokens are pastel fills; mixing toward text keeps lines legible.
      return `color-mix(in oklch, var(--board-swatch-${color}) 45%, var(--board-text))`
  }
}

export function boardFillCss(fill: BoardFillColor): string {
  if (fill === 'none') {
    return 'transparent'
  }
  if (isBoardCustomColor(fill)) {
    return fill
  }
  return fill === 'accent' ? 'var(--board-accent-tint)' : `var(--board-swatch-${fill})`
}

const STROKE_PX: Record<BoardStrokeWidth, number> = { thin: 1.5, medium: 3, bold: 5 }

export function boardStrokePx(width: BoardStrokeWidth): number {
  return STROKE_PX[width]
}

/** SVG stroke-dasharray for the style at a given width, or undefined for solid. */
export function boardStrokeDashArray(style: BoardStrokeStyle, px: number): string | undefined {
  switch (style) {
    case 'solid':
      return undefined
    case 'dashed':
      return `${px * 3} ${px * 2}`
    case 'dotted':
      return `0 ${px * 2}`
  }
}

/** Max wobble in px a hand-drawn renderer may apply (0 = ruler straight). */
export function boardSloppinessPx(sloppiness: BoardSloppiness): number {
  return sloppiness === 'architect' ? 0 : sloppiness === 'artist' ? 1.5 : 3
}

const TEXT_PX: Record<BoardTextSize, number> = { small: 14, medium: 18, large: 26, xlarge: 38 }

export function boardTextPx(size: BoardTextSize): number {
  return TEXT_PX[size]
}

// ponytail: system font stacks, nothing bundled; bundle OFL hand/script faces if the look must match on every OS.
const FONT_STACKS: Record<BoardTextFont, string> = {
  sans: "'Inter Variable', ui-sans-serif, system-ui, sans-serif",
  rounded: "ui-rounded, 'SF Pro Rounded', 'Nunito', system-ui, sans-serif",
  serif: "ui-serif, Georgia, 'Times New Roman', serif",
  mono: "'JetBrains Mono Variable', ui-monospace, monospace",
  hand: "'Bradley Hand', 'Segoe Print', 'Comic Sans MS', cursive",
  script: "'Snell Roundhand', 'Segoe Script', 'Brush Script MT', cursive"
}

export function boardFontFamily(font: BoardTextFont): string {
  return FONT_STACKS[font]
}
