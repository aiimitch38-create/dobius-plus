// The terminal screen as plain-text rows, for a console card's zoomed-out
// miniature. Works on any xterm-shaped buffer (renderer xterm or
// @xterm/headless), so it is testable without a DOM.

export type TailBufferLine = { translateToString(trimRight?: boolean): string }
export type TailBuffer = { length: number; getLine(y: number): TailBufferLine | undefined }

/** Longer rows are clipped by the miniature anyway; cap so a huge row is not copied around. */
const MAX_LINE_CHARS = 400

const clip = (line: string): string =>
  line.length > MAX_LINE_CHARS ? line.slice(0, MAX_LINE_CHARS) : line

/**
 * Every row of the buffer top to bottom, exactly as the terminal shows it
 * (box borders, blank rows and all), minus the blank rows under the last
 * output so a short screen does not read as a gap.
 */
export function consoleScreenRows(buffer: TailBuffer): string[] {
  const rows: string[] = []
  for (let y = 0; y < buffer.length; y += 1) {
    rows.push(clip(buffer.getLine(y)?.translateToString(true) ?? ''))
  }
  let end = rows.length
  while (end > 0 && rows[end - 1].trim().length === 0) {
    end -= 1
  }
  return rows.slice(0, end)
}

/** Trailing rows of a plain-text reply, used when no terminal screen is readable. */
export function textTailLines(text: string, maxLines: number): string[] {
  const lines = text.split(/\r?\n/).map((line) => clip(line.trimEnd()))
  let end = lines.length
  while (end > 0 && lines[end - 1].trim().length === 0) {
    end -= 1
  }
  return lines.slice(0, end).slice(maxLines > 0 ? -maxLines : 0)
}

export function sameLines(a: readonly string[] | null, b: readonly string[] | null): boolean {
  if (a === b) {
    return true
  }
  if (!a || !b || a.length !== b.length) {
    return false
  }
  return a.every((line, i) => line === b[i])
}

// ---- Styled screen (colours and attributes) --------------------------------

export type CellColor =
  | { mode: 'default' }
  | { mode: 'palette'; index: number }
  | { mode: 'rgb'; rgb: number }

/** A run of adjacent cells that share colours and attributes. */
export type MiniRun = {
  text: string
  fg: CellColor
  bg: CellColor
  bold: boolean
  dim: boolean
  italic: boolean
  underline: boolean
  inverse: boolean
  strike: boolean
  invisible: boolean
}

/** The subset of xterm's IBufferCell the miniature reads. */
export type StyledBufferCell = {
  getChars(): string
  getWidth(): number
  getFgColor(): number
  getBgColor(): number
  isFgRGB(): boolean
  isBgRGB(): boolean
  isFgPalette(): boolean
  isBgPalette(): boolean
  isBold(): number
  isDim(): number
  isItalic(): number
  isUnderline(): number
  isInverse(): number
  isStrikethrough(): number
  isInvisible(): number
}
export type StyledBufferLine = {
  getCell(x: number, cell?: StyledBufferCell): StyledBufferCell | undefined
}
export type StyledTailBuffer = {
  length: number
  getLine(y: number): StyledBufferLine | undefined
  getNullCell(): StyledBufferCell
}

/** The visible screen as styled rows, plus the terminal size they were laid out at. */
export type ConsoleScreen = { cols: number; rows: number; lines: MiniRun[][] }

const DEFAULT: CellColor = { mode: 'default' }

function cellColor(rgb: boolean, palette: boolean, value: number): CellColor {
  return rgb ? { mode: 'rgb', rgb: value } : palette ? { mode: 'palette', index: value } : DEFAULT
}

const sameColor = (a: CellColor, b: CellColor): boolean =>
  a.mode === b.mode &&
  (a.mode === 'default' ||
    (a.mode === 'palette' && b.mode === 'palette' && a.index === b.index) ||
    (a.mode === 'rgb' && b.mode === 'rgb' && a.rgb === b.rgb))

const sameStyle = (a: MiniRun, b: MiniRun): boolean =>
  sameColor(a.fg, b.fg) &&
  sameColor(a.bg, b.bg) &&
  a.bold === b.bold &&
  a.dim === b.dim &&
  a.italic === b.italic &&
  a.underline === b.underline &&
  a.inverse === b.inverse &&
  a.strike === b.strike &&
  a.invisible === b.invisible

const isPlainBlank = (run: MiniRun): boolean =>
  run.text.trim() === '' &&
  run.bg.mode === 'default' &&
  !run.inverse &&
  !run.underline &&
  !run.strike

/**
 * One buffer row as styled runs, cut at `cols` cells and with trailing plain
 * blanks dropped. Wide glyphs take their own cell; their spacer is skipped.
 */
export function styledRow(
  line: StyledBufferLine | undefined,
  cols: number,
  scratch: StyledBufferCell
): MiniRun[] {
  const runs: MiniRun[] = []
  if (!line) {
    return runs
  }
  for (let x = 0; x < cols; x += 1) {
    const cell = line.getCell(x, scratch)
    if (!cell) {
      break
    }
    const width = cell.getWidth()
    if (width === 0) {
      continue
    }
    const run: MiniRun = {
      text: cell.getChars() || ' ',
      fg: cellColor(cell.isFgRGB(), cell.isFgPalette(), cell.getFgColor()),
      bg: cellColor(cell.isBgRGB(), cell.isBgPalette(), cell.getBgColor()),
      bold: cell.isBold() !== 0,
      dim: cell.isDim() !== 0,
      italic: cell.isItalic() !== 0,
      underline: cell.isUnderline() !== 0,
      inverse: cell.isInverse() !== 0,
      strike: cell.isStrikethrough() !== 0,
      invisible: cell.isInvisible() !== 0
    }
    const last = runs.at(-1)
    if (last && sameStyle(last, run)) {
      last.text += run.text
    } else {
      runs.push(run)
    }
  }
  for (let last = runs.at(-1); last; last = runs.at(-1)) {
    if (isPlainBlank(last)) {
      runs.pop()
      continue
    }
    const trimmed = last.text.replace(/ +$/, '')
    if (trimmed !== last.text && last.bg.mode === 'default' && !last.inverse && !last.underline) {
      last.text = trimmed
    }
    break
  }
  return runs
}

/** Every visible row as styled runs, minus the blank rows under the last output. */
export function consoleScreenRuns(buffer: StyledTailBuffer, cols: number): MiniRun[][] {
  const scratch = buffer.getNullCell()
  const rows: MiniRun[][] = []
  for (let y = 0; y < buffer.length; y += 1) {
    rows.push(styledRow(buffer.getLine(y), Math.min(cols, MAX_LINE_CHARS), scratch))
  }
  let end = rows.length
  while (end > 0 && rows[end - 1].length === 0) {
    end -= 1
  }
  return rows.slice(0, end)
}

/** Cheap change check: the same screen produces the same key. */
export function screenKey(screen: ConsoleScreen | null): string {
  return screen ? `${screen.cols}x${screen.rows}:${JSON.stringify(screen.lines)}` : ''
}

// ---- Glance polling policy (pure; the hook applies it) ----------------------

/** Poll delay after N consecutive unchanged snapshots; the last entry repeats. */
export const GLANCE_BACKOFF_MS: readonly number[] = [1000, 2000, 5000, 10_000]

export function glanceBackoffMs(
  unchangedStreak: number,
  backoff: readonly number[] = GLANCE_BACKOFF_MS
): number {
  return backoff[Math.min(Math.max(0, unchangedStreak), backoff.length - 1)]
}

export type GlanceSnapshotIdentity = { data: string; cols: number; rows: number; seq?: number }

/**
 * True when a new snapshot cannot draw differently from the last one, so the
 * ANSI parse can be skipped. Main's `seq` counts PTY bytes painted into its
 * emulator; an equal seq at the same size is the same screen. Without a seq
 * (renderer-sourced snapshots) the raw string decides.
 */
export function sameConsoleSnapshot(
  prev: GlanceSnapshotIdentity | null,
  next: GlanceSnapshotIdentity
): boolean {
  if (!prev || prev.cols !== next.cols || prev.rows !== next.rows) {
    return false
  }
  if (typeof prev.seq === 'number' && typeof next.seq === 'number' && prev.seq !== next.seq) {
    return false
  }
  return prev.data === next.data
}

export type GlancePollGate = {
  /** document.visibilityState === 'hidden' */
  hidden: boolean
  /** document.hasFocus() */
  focused: boolean
  unchangedStreak: number
  /** Milliseconds since the board camera last moved. */
  sinceMotionMs: number
}

export type GlancePollSkip = 'hidden' | 'unfocused-idle' | 'moving' | null

/**
 * Why a card may not poll right now. 'moving' is transient (retry after the
 * quiet window); the other two sleep until a focus, visibility or output
 * event wakes the card. Unfocused windows still poll until the screen has
 * been unchanged long enough to reach the slowest backoff step.
 */
export function glancePollSkipReason(
  gate: GlancePollGate,
  quietMs: number,
  backoff: readonly number[] = GLANCE_BACKOFF_MS
): GlancePollSkip {
  if (gate.hidden) {
    return 'hidden'
  }
  if (!gate.focused && gate.unchangedStreak >= backoff.length - 1) {
    return 'unfocused-idle'
  }
  if (gate.sinceMotionMs < quietMs) {
    return 'moving'
  }
  return null
}
