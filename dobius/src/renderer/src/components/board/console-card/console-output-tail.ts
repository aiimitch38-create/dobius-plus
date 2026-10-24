// The last lines of a terminal screen as plain text, for a console card's
// zoomed-out glance. Works on any xterm-shaped buffer (renderer xterm or
// @xterm/headless), so it is testable without a DOM.

export type TailBufferLine = { translateToString(trimRight?: boolean): string }
export type TailBuffer = { length: number; getLine(y: number): TailBufferLine | undefined }

export const GLANCE_TAIL_LINES = 12
/** Longer lines are clipped by the glance anyway; cap so a huge row is not copied around. */
const MAX_LINE_CHARS = 240

// Why: TUI agents frame their prompt in box-drawing borders; a line made only
// of borders, blocks and spaces carries nothing a glance reader can use.
const DECORATIVE_ONLY = /^[\s─-▟⠀-⣿·•…_=-]*$/u

export function isDecorativeLine(line: string): boolean {
  return DECORATIVE_ONLY.test(line)
}

/** Strips the box-drawing frame a TUI draws around a row, keeping its text. */
export function unframeLine(line: string): string {
  return line
    .replace(/^\s*[│┃║|]\s?/u, '')
    .replace(/\s?[│┃║|]\s*$/u, '')
    .trimEnd()
}

/** Newest-last list of up to `maxLines` meaningful lines from the bottom of the buffer. */
export function consoleTailLines(buffer: TailBuffer, maxLines = GLANCE_TAIL_LINES): string[] {
  const out: string[] = []
  for (let y = buffer.length - 1; y >= 0 && out.length < maxLines; y -= 1) {
    const raw = buffer.getLine(y)?.translateToString(true) ?? ''
    if (isDecorativeLine(raw)) {
      continue
    }
    const text = unframeLine(raw)
    if (text.trim().length === 0) {
      continue
    }
    out.push(text.length > MAX_LINE_CHARS ? text.slice(0, MAX_LINE_CHARS) : text)
  }
  return out.toReversed()
}

/** Trailing excerpt of a plain-text reply, used when no terminal screen is readable. */
export function textTailLines(text: string, maxLines = GLANCE_TAIL_LINES): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
  return lines
    .slice(-maxLines)
    .map((l) => (l.length > MAX_LINE_CHARS ? l.slice(0, MAX_LINE_CHARS) : l))
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
