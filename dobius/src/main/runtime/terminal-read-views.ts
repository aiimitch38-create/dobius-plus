import type { RuntimeTerminalScreenRead } from '../../shared/runtime-types'

// Why this module: `terminal read`'s `tail` is a line log of the raw PTY
// stream. Full-screen TUIs (Claude Code, Codex) redraw in place with cursor-up
// and erase codes, so that log collapses to the last few redraw rows. These
// helpers build the rendered screen from the headless xterm mirror instead;
// terminal-transcript-read.ts reads the agent's own JSONL transcript.

export const DEFAULT_SCREEN_READ_LIMIT = 120
export const MAX_SCREEN_READ_LIMIT = 2000
export const MAX_SCREEN_READ_CHARS = 64 * 1024

export type RenderedRowsInput = {
  rows: { text: string; wrapped: boolean }[]
  firstReturnedRow: number
  totalRows: number
  firstScreenRow: number
  cursorRow: number
  cols: number
  screenRows: number
  alternateScreen: boolean
  scrollbackCapacity: number
}

export function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return fallback
  }
  return Math.min(Math.floor(value), max)
}

export function screenReadRowBudget(limit: number | undefined): number {
  // Why: rows are fetched before soft-wrapped rows are rejoined, so ask for
  // enough rows that `limit` logical lines are still covered when many wrap.
  return clampLimit(limit, DEFAULT_SCREEN_READ_LIMIT, MAX_SCREEN_READ_LIMIT) * 4
}

type LogicalLine = { text: string; startRow: number }

/** Turn rendered rows into the bounded screen + scrollback view. */
export function buildRenderedScreenRead(
  input: RenderedRowsInput,
  opts: { limit?: number; maxChars?: number; historyIncomplete?: string } = {}
): RuntimeTerminalScreenRead {
  const limit = clampLimit(opts.limit, DEFAULT_SCREEN_READ_LIMIT, MAX_SCREEN_READ_LIMIT)
  const maxChars = opts.maxChars ?? MAX_SCREEN_READ_CHARS

  const logical: LogicalLine[] = []
  for (let offset = 0; offset < input.rows.length; offset += 1) {
    const row = input.rows[offset]!
    const absoluteRow = input.firstReturnedRow + offset
    const previous = logical.at(-1)
    // Why: a wrapped row continues the previous logical line. The first
    // returned row can be a continuation whose head was not fetched; it then
    // starts its own (partial) line rather than being dropped.
    if (row.wrapped && previous) {
      previous.text += row.text
    } else {
      logical.push({ text: row.text, startRow: absoluteRow })
    }
  }
  for (const line of logical) {
    line.text = line.text.replace(/[ \t]+$/g, '')
  }

  // Why: the screen is a fixed grid; blank rows below the last content are
  // padding, not output.
  let end = logical.length
  while (end > 0 && logical[end - 1]!.text.trim().length === 0) {
    end -= 1
  }
  let kept = logical.slice(0, end)
  const fetchedOlderThanKept = input.firstReturnedRow > 0
  let limited = fetchedOlderThanKept
  if (kept.length > limit) {
    kept = kept.slice(kept.length - limit)
    limited = true
  }
  let totalChars = kept.reduce((sum, line) => sum + line.text.length + 1, 0)
  let drop = 0
  while (drop < kept.length - 1 && totalChars > maxChars) {
    totalChars -= kept[drop]!.text.length + 1
    drop += 1
  }
  if (drop > 0) {
    kept = kept.slice(drop)
    limited = true
  }

  const screen: string[] = []
  const scrollback: string[] = []
  for (const line of kept) {
    if (line.startRow >= input.firstScreenRow) {
      screen.push(line.text)
    } else {
      scrollback.push(line.text)
    }
  }
  const scrollbackRowsRetained = Math.max(0, input.firstScreenRow)
  // A screen line that is itself over budget keeps only its tail.
  if (totalChars > maxChars && kept.length === 1) {
    const only = screen.length > 0 ? screen : scrollback
    only[0] = only[0]!.slice(-maxChars)
    limited = true
  }
  return {
    available: true,
    source: 'headless-emulator',
    cols: input.cols,
    rows: input.screenRows,
    alternateScreen: input.alternateScreen,
    scrollback,
    screen,
    limited,
    scrollbackRowsRetained,
    scrollbackCapacity: input.scrollbackCapacity,
    scrollbackMayBeEvicted:
      !input.alternateScreen && scrollbackRowsRetained >= input.scrollbackCapacity,
    ...(opts.historyIncomplete ? { historyIncomplete: opts.historyIncomplete } : {})
  }
}
