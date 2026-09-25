// The inner command of `sh -c '<string>'` for the agent hard rails.

const SHELL_INVOCATION = /(?:^|[\s;&|(`])(?:\S*\/)?(?:ba|z|da|k|fi)?sh(?=[ \t])/g

// One shell word starting at `index`: quotes joined and removed. Null when a
// quote is never closed.
function readWord(text: string, index: number): { word: string; end: number } | null {
  let word = ''
  let cursor = index
  while (cursor < text.length && !/[\s;&|<>()]/.test(text[cursor])) {
    const char = text[cursor]
    if (char === "'") {
      const close = text.indexOf("'", cursor + 1)
      if (close === -1) {
        return null
      }
      word += text.slice(cursor + 1, close)
      cursor = close + 1
    } else if (char === '"') {
      let close = cursor + 1
      while (close < text.length && text[close] !== '"') {
        close += text[close] === '\\' ? 2 : 1
      }
      if (close >= text.length) {
        return null
      }
      word += text.slice(cursor + 1, close).replace(/\\(["\\$`])/g, '$1')
      cursor = close + 1
    } else if (char === '\\') {
      word += text[cursor + 1] ?? ''
      cursor += 2
    } else {
      word += char
      cursor += 1
    }
  }
  return { word, end: cursor }
}

function skipBlanks(text: string, index: number): number {
  let cursor = index
  while (text[cursor] === ' ' || text[cursor] === '\t') {
    cursor += 1
  }
  return cursor
}

type ShellCParse = { inner: string } | { unparsable: true } | null

// Options of `sh ... -c <operand>`: `--long`, `-o/-O/+o/+O <word>`, letter
// clusters; `--` after the -c cluster is skipped. Null when there is no -c.
function parseShellC(text: string, index: number): ShellCParse {
  let cursor = index
  for (;;) {
    cursor = skipBlanks(text, cursor)
    const token = readWord(text, cursor)
    if (!token || token.word === '') {
      return null
    }
    cursor = token.end
    if (/^[-+][oO]$/.test(token.word)) {
      const value = readWord(text, skipBlanks(text, cursor))
      cursor = value?.end ?? cursor
      continue
    }
    if (token.word.startsWith('--') || /^\+[A-Za-z]+$/.test(token.word)) {
      continue
    }
    if (!/^-[A-Za-z]+$/.test(token.word)) {
      return null
    }
    if (!token.word.includes('c')) {
      continue
    }
    cursor = skipBlanks(text, cursor)
    const dashes = readWord(text, cursor)
    if (dashes?.word === '--') {
      cursor = skipBlanks(text, dashes.end)
    }
    const operand = readWord(text, cursor)
    return operand && operand.word !== '' ? { inner: operand.word } : { unparsable: true }
  }
}

/**
 * Inner command strings run by `sh|bash|zsh|dash|ksh|fish -c` anywhere in
 * `command`; `unparsable` when an operand could not be read (caller denies).
 */
export function shellCInnerCommands(command: string): { inner: string[]; unparsable: boolean } {
  const inner: string[] = []
  let unparsable = false
  for (const match of command.matchAll(SHELL_INVOCATION)) {
    const parsed = parseShellC(command, (match.index ?? 0) + match[0].length)
    if (parsed && 'inner' in parsed) {
      inner.push(parsed.inner)
    } else if (parsed) {
      unparsable = true
    }
  }
  return { inner, unparsable }
}
