// Pure layout for a console's zoomed-out miniature: the terminal screen drawn
// as plain text at the card's zoom-1 size, with the live terminal's own font,
// padding and colors, so the board's zoom shrinks it like the real thing.
import type { GlobalSettings } from '../../../../../shared/types'
import { buildFontFamily } from '@/components/terminal-pane/layout-serialization'
import { composeActiveTerminalTheme } from '@/components/terminal-pane/terminal-appearance'
import { getBuiltinTheme, resolveEffectiveTerminalAppearance } from '@/lib/terminal-theme'
import { resolveTerminalFontWeights } from '../../../../../shared/terminal-fonts'
import type { CellColor, ConsoleScreen, MiniRun } from './console-output-tail'

// Why: xterm's cell is roughly 1.2x the font size at lineHeight 1 (measured glyph box).
const XTERM_CELL_FACTOR = 1.2
const DEFAULT_PADDING_PX = 4
// Why: FitAddon reserves the live terminal's scrollbar width as a gutter
// (pane-terminal-options scrollbar.width), so the cells span less than the body.
const XTERM_SCROLLBAR_GUTTER_PX = 7

// xterm ITheme keys for palette entries 0-15, in order.
const ANSI_KEYS = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite'
] as const

export type ConsoleMiniatureStyle = {
  fontSize: number
  fontFamily: string | undefined
  lineHeightPx: number
  paddingX: number
  paddingY: number
  /** The live terminal theme colors; board tokens when no theme resolves. */
  background: string
  foreground: string
  /** Theme ANSI colours 0-15; null entries fall back to the foreground. */
  ansi?: readonly (string | null)[]
  fontWeight?: number
  fontWeightBold?: number
}

type MiniatureSettings = Pick<
  GlobalSettings,
  | 'terminalFontSize'
  | 'terminalFontFamily'
  | 'terminalLineHeight'
  | 'terminalPaddingX'
  | 'terminalPaddingY'
  | 'theme'
  | 'terminalThemeDark'
  | 'terminalDividerColorDark'
  | 'terminalUseSeparateLightTheme'
  | 'terminalThemeLight'
  | 'terminalCustomThemes'
  | 'terminalDividerColorLight'
  | 'terminalColorOverrides'
  | 'terminalBackgroundOpacity'
  | 'terminalCursorOpacity'
  | 'terminalFontWeight'
>

export function consoleMiniatureStyle(
  settings: MiniatureSettings | null | undefined,
  systemPrefersDark?: boolean
): ConsoleMiniatureStyle {
  const fontSize = settings?.terminalFontSize ?? 14
  const lineHeight = settings?.terminalLineHeight ?? 1
  let background = 'var(--board-panel)'
  let foreground = 'var(--board-text)'
  let ansi: (string | null)[] | undefined
  if (settings) {
    const appearance = resolveEffectiveTerminalAppearance(settings, systemPrefersDark)
    const theme = composeActiveTerminalTheme(
      appearance.theme ?? getBuiltinTheme(appearance.themeName),
      settings
    )
    background = theme?.background ?? background
    foreground = theme?.foreground ?? foreground
    ansi = theme ? ANSI_KEYS.map((key) => theme[key] ?? null) : undefined
  }
  const weights = resolveTerminalFontWeights(settings?.terminalFontWeight)
  return {
    fontSize,
    fontFamily: settings ? buildFontFamily(settings.terminalFontFamily ?? '') : undefined,
    lineHeightPx: fontSize * XTERM_CELL_FACTOR * (lineHeight > 0 ? lineHeight : 1),
    paddingX: settings?.terminalPaddingX ?? DEFAULT_PADDING_PX,
    paddingY: settings?.terminalPaddingY ?? DEFAULT_PADDING_PX,
    background,
    foreground,
    ansi,
    fontWeight: weights.fontWeight,
    fontWeightBold: weights.fontWeightBold
  }
}

/** Rows that fit a body of this world-px height; 0 while unmeasured means "show all". */
export function miniatureFitRows(
  bodyHeight: number,
  style: Pick<ConsoleMiniatureStyle, 'paddingY' | 'lineHeightPx'>
): number {
  if (bodyHeight <= 0) {
    return 0
  }
  return Math.max(1, Math.floor((bodyHeight - style.paddingY * 2) / style.lineHeightPx))
}

/** The newest `fit` rows, as a terminal scrolled to the bottom shows them (fit 0 = all). */
export function miniatureRows<T>(rows: readonly T[], fit: number): T[] {
  return fit > 0 && rows.length > fit ? rows.slice(-fit) : [...rows]
}

/** xterm's 256-colour table entries 16-255 (6x6x6 cube, then a grey ramp). */
function xterm256(index: number): string {
  if (index >= 232) {
    const v = 8 + (index - 232) * 10
    return `rgb(${v}, ${v}, ${v})`
  }
  const i = index - 16
  const level = (n: number): number => (n === 0 ? 0 : 55 + n * 40)
  return `rgb(${level(Math.floor(i / 36))}, ${level(Math.floor(i / 6) % 6)}, ${level(i % 6)})`
}

function colorCss(
  color: CellColor,
  style: ConsoleMiniatureStyle,
  fallback: string,
  bold: boolean
): string {
  if (color.mode === 'rgb') {
    return `#${color.rgb.toString(16).padStart(6, '0')}`
  }
  if (color.mode === 'palette') {
    // Why: the live terminal sets drawBoldTextInBrightColors, so bold 0-7 shows as 8-15.
    const index = bold && color.index < 8 ? color.index + 8 : color.index
    return index < 16 ? (style.ansi?.[index] ?? fallback) : xterm256(index)
  }
  return fallback
}

export type MiniRunStyle = {
  color?: string
  backgroundColor?: string
  fontWeight?: number
  fontStyle?: 'italic'
  opacity?: number
  textDecoration?: string
  visibility?: 'hidden'
}

/** Inline style for one run, coloured from the live terminal theme. Default cells get none. */
export function miniRunStyle(run: MiniRun, style: ConsoleMiniatureStyle): MiniRunStyle {
  let fg = colorCss(run.fg, style, style.foreground, run.bold)
  let bg = colorCss(run.bg, style, style.background, false)
  let fgSet = run.fg.mode !== 'default'
  let bgSet = run.bg.mode !== 'default'
  if (run.inverse) {
    ;[fg, bg] = [bg, fg]
    fgSet = true
    bgSet = true
  }
  const out: MiniRunStyle = {}
  if (fgSet) {
    out.color = fg
  }
  if (bgSet) {
    out.backgroundColor = bg
  }
  if (run.bold && style.fontWeightBold !== undefined) {
    out.fontWeight = style.fontWeightBold
  }
  if (run.italic) {
    out.fontStyle = 'italic'
  }
  if (run.dim) {
    out.opacity = 0.5
  }
  const decorations = [run.underline ? 'underline' : '', run.strike ? 'line-through' : '']
    .filter(Boolean)
    .join(' ')
  if (decorations) {
    out.textDecoration = decorations
  }
  if (run.invisible) {
    out.visibility = 'hidden'
  }
  return out
}

/**
 * Cell geometry that reproduces the live grid: each of the terminal's `cols`
 * cells spans the same width as in the live pane (so rows never re-wrap or
 * overflow), and each row the same height.
 */
export function miniatureCellBox(
  screen: Pick<ConsoleScreen, 'cols' | 'rows'> | null,
  bodyWidth: number,
  bodyHeight: number,
  style: ConsoleMiniatureStyle
): { cellWidthPx: number | null; lineHeightPx: number } {
  if (!screen || screen.cols <= 0 || bodyWidth <= 0) {
    return { cellWidthPx: null, lineHeightPx: style.lineHeightPx }
  }
  const usableWidth = bodyWidth - style.paddingX * 2 - XTERM_SCROLLBAR_GUTTER_PX
  const usableHeight = bodyHeight - style.paddingY * 2
  return {
    cellWidthPx: usableWidth > 0 ? usableWidth / screen.cols : null,
    // Why: the live rows fill the body; fall back to the font estimate if unmeasured.
    lineHeightPx:
      bodyHeight > 0 && screen.rows > 0 && usableHeight > 0
        ? Math.min(usableHeight / screen.rows, style.lineHeightPx * 1.5)
        : style.lineHeightPx
  }
}
