// A small, strict reader for shell command lines, used to decide whether a
// Bash call is known to stay on this Mac. It does not try to understand all of
// shell: anything it cannot read with certainty returns null, and the caller
// treats that as outward.

export type ShellSimpleCommand = {
  /** Command name and arguments, quotes removed, redirections taken out. */
  words: string[]
  /** Files the command redirects to or from. */
  redirectTargets: string[]
}

type RawWord = { text: string; redirect: boolean }

// `>file`, `>>file`, `2>file`, `&>file`, `<file`; the target may be the next word.
const FILE_REDIRECT = /^\d*(?:&>>|&>|>>|>\||>|<)(.*)$/
// `2>&1`, `>&2`: one stream copied onto another, no file involved.
const STREAM_COPY = /^\d*[<>]&(?:\d+|-)$/

function readRawSegments(command: string): RawWord[][] | null {
  const segments: RawWord[][] = []
  let words: RawWord[] = []
  let text = ''
  let inWord = false
  let redirect = false
  let quote: '"' | "'" | null = null
  const endWord = (): void => {
    if (inWord) {
      words.push({ text, redirect })
    }
    text = ''
    inWord = false
    redirect = false
  }
  const endSegment = (): void => {
    endWord()
    if (words.length > 0) {
      segments.push(words)
    }
    words = []
  }
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    if (quote) {
      if (char === quote) {
        quote = null
      } else if (char === '\\' && quote === '"' && index + 1 < command.length) {
        index += 1
        text += command[index]
      } else {
        text += char
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      inWord = true
    } else if (char === '\\') {
      if (index + 1 >= command.length) {
        return null
      }
      index += 1
      text += command[index]
      inWord = true
    } else if (char === '(' || char === ')' || char === '{' || char === '}') {
      // Subshells and groups.
      return null
    } else if (char === '<' || char === '>') {
      text += char
      inWord = true
      redirect = true
    } else if (char === '&' && (command[index - 1] === '>' || command[index + 1] === '>')) {
      // Part of a redirection such as `2>&1` or `&>file`, not a separator.
      text += char
      inWord = true
      redirect = true
    } else if (char === ';' || char === '&' || char === '|' || char === '\n') {
      endSegment()
    } else if (char === ' ' || char === '\t' || char === '\r') {
      endWord()
    } else {
      text += char
      inWord = true
    }
  }
  if (quote) {
    return null
  }
  endSegment()
  return segments
}

function toSimpleCommand(raw: RawWord[]): ShellSimpleCommand | null {
  const words: string[] = []
  const redirectTargets: string[] = []
  for (let index = 0; index < raw.length; index += 1) {
    const word = raw[index]
    if (!word.redirect) {
      words.push(word.text)
      continue
    }
    if (STREAM_COPY.test(word.text)) {
      continue
    }
    const match = FILE_REDIRECT.exec(word.text)
    if (!match) {
      // Here-documents, `a>b`, anything else unusual.
      return null
    }
    let target = match[1]
    if (!target) {
      const next = raw[index + 1]
      if (!next || next.redirect) {
        return null
      }
      target = next.text
      index += 1
    }
    redirectTargets.push(target)
  }
  return words.length > 0 ? { words, redirectTargets } : null
}

// Command and process substitution run a second command inside the first,
// even inside double quotes.
const SUBSTITUTION = /`|\$\(|<\(|>\(/

/**
 * Splits a command line into its simple commands (split on `;`, `&&`, `||`,
 * `|`, `&` and newlines). Returns null when the line holds a substitution, a
 * subshell, an open quote, or a redirection it does not recognise.
 */
export function readShellCommand(command: string): ShellSimpleCommand[] | null {
  if (!command.trim() || SUBSTITUTION.test(command)) {
    return null
  }
  const raw = readRawSegments(command)
  if (!raw || raw.length === 0) {
    return null
  }
  const commands: ShellSimpleCommand[] = []
  for (const segment of raw) {
    const simple = toSimpleCommand(segment)
    if (!simple) {
      return null
    }
    commands.push(simple)
  }
  return commands
}
