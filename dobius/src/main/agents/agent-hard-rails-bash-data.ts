// Which parts of a Bash command are pure data (commit/PR messages, heredoc
// bodies written to a file) and can be hidden from the text rails. The rules
// are deliberately coarse and fail closed (CX12 r3): when in doubt nothing is
// stripped and the whole command is scanned. Interpreters that build paths or
// run git through their own APIs are out of scope for text rails (SBX covers
// files; server-side branch protection covers pushes).

const QUOTED_HEREDOC = /<<-?[ \t]*(['"])([A-Za-z_][\w-]*)\1/g
const MESSAGE_OPTION = String.raw`(?:-m|--message|--title|-t|--body|-b)`
const HEREDOC_MESSAGE_ARG = new RegExp(
  String.raw`(\s${MESSAGE_OPTION}(?:[ \t]+|=))"\$\([ \t]*cat[ \t]+<<-?[ \t]*(['"])([A-Za-z_][\w-]*)\2[ \t]*\n[\s\S]*?\n[ \t]*\3[ \t]*\n?[ \t]*\)"(?=$|[\s;&|)])`,
  'g'
)
const QUOTED_MESSAGE_ARG = new RegExp(
  String.raw`(\s${MESSAGE_OPTION}(?:[ \t]+|=))("(?:[^"\\]|\\.)*"|'[^']*')(?=$|[\s;&|)])`,
  'g'
)

// Words that run text as code, anywhere in the command (`.` only as a command).
const CODE_RUNNERS = new Set([
  'sh',
  'bash',
  'zsh',
  'dash',
  'ksh',
  'fish',
  'eval',
  'source',
  'exec',
  'env',
  'command',
  'xargs',
  'python',
  'python3',
  'node',
  'deno',
  'bun',
  'perl',
  'ruby',
  'php',
  'awk',
  'gawk',
  'osascript',
  'lua'
])
const DOT_COMMAND = /(?:^|[;&|\n(`])[ \t]*\.[ \t]/
const RUNS_WRITTEN_FILE =
  /(?:^|[;&|\n(`])[ \t]*(?:\.\/|chmod[ \t]+(?:\S+[ \t]+)*(?:\+x|[0-7]*[1357]\b))/
const EXPANSION_AS_COMMAND = /(?:^|[;&|\n(`])[ \t]*[$`]/
const MESSAGE_RISKS = /\||<\(|>\(|(?:^|[\s;&(])(?:eval|source)(?:$|\s)/

function wordOf(token: string): string {
  return (
    token
      .replace(/["'\\]/g, '')
      .split('/')
      .pop() ?? ''
  )
}

function hasCodeRunner(text: string): boolean {
  const words = text.split(/[\s;&|()<>`]+/).map(wordOf)
  return words.some((word) => CODE_RUNNERS.has(word)) || DOT_COMMAND.test(text)
}

// First word of the command `offset` sits in; null inside `$(..)` / backticks.
function commandWordAt(text: string, offset: number): string | null {
  let start = offset
  while (start > 0 && !/[;&|\n(`]/.test(text[start - 1])) {
    start -= 1
  }
  if (start > 0 && /[(`]/.test(text[start - 1])) {
    return null
  }
  const words = text.slice(start, offset).trim().split(/\s+/)
  const word = words.find((entry) => entry && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(entry))
  return word ? wordOf(word) : null
}

// `$(..)` bodies inside a double-quoted message; null when one cannot be read.
function substitutionsIn(arg: string): string[] | null {
  const inner: string[] = []
  for (let index = arg.indexOf('$('); index !== -1; index = arg.indexOf('$(', index + 2)) {
    let depth = 0
    let end = index + 1
    for (; end < arg.length; end += 1) {
      depth += arg[end] === '(' ? 1 : arg[end] === ')' ? -1 : 0
      if (depth === 0) {
        break
      }
    }
    const body = arg.slice(index + 2, end)
    if (end >= arg.length || body.includes('<<') || body.includes('`')) {
      return null
    }
    inner.push(body)
  }
  return arg.startsWith("'") || !arg.includes('`') ? inner : null
}

const isGitOrGh = (word: string | null): boolean => word === 'git' || word === 'gh'

function stripMessageArgs(command: string, inner: string[]): string {
  const withoutHeredocs = command.replace(HEREDOC_MESSAGE_ARG, (match, lead: string, ...rest) => {
    const offset = rest[2] as number
    return isGitOrGh(commandWordAt(command, offset + 1)) ? `${lead}"MSG"` : match
  })
  return withoutHeredocs.replace(
    QUOTED_MESSAGE_ARG,
    (match, lead: string, arg: string, offset: number) => {
      if (!isGitOrGh(commandWordAt(withoutHeredocs, offset + 1))) {
        return match
      }
      const substitutions = arg.startsWith('"') ? substitutionsIn(arg) : []
      if (substitutions === null) {
        return match
      }
      inner.push(...substitutions)
      return `${lead}"MSG"`
    }
  )
}

// Heredoc bodies that are plain file content or a commit/PR message from stdin.
function isDataHeredoc(line: string, word: string | null): boolean {
  if (word === 'cat') {
    return true
  }
  const stdinFile = /(?:^|\s)(?:-F[ \t]*-|--file(?:=|[ \t]+)-|--body-file(?:=|[ \t]+)-)(?:\s|$)/
  return (word === 'git' || word === 'gh') && stdinFile.test(line)
}

function stripDataHeredocs(command: string): string {
  let result = command
  for (let searchFrom = 0; ; ) {
    QUOTED_HEREDOC.lastIndex = searchFrom
    const match = QUOTED_HEREDOC.exec(result)
    if (!match) {
      return result
    }
    const lineEnd = result.indexOf('\n', match.index)
    const tag = match[2]
    const close =
      lineEnd === -1
        ? null
        : new RegExp(String.raw`\n[ \t]*${tag}[ \t]*(?=\n|$)`).exec(result.slice(lineEnd))
    const lineStart = result.lastIndexOf('\n', match.index) + 1
    if (
      !close ||
      !isDataHeredoc(result.slice(lineStart, lineEnd), commandWordAt(result, match.index))
    ) {
      searchFrom = match.index + match[0].length
      continue
    }
    result = `${result.slice(0, lineEnd)}${result.slice(lineEnd + close.index)}`
    searchFrom = lineEnd + 1
  }
}

/**
 * The command text the rails scan (`effective`) plus `$(..)` commands taken
 * out of stripped messages, which the caller evaluates on their own.
 */
export function prepareBashCommand(command: string): { effective: string; inner: string[] } {
  const inner: string[] = []
  const messagesOut = stripMessageArgs(command, inner)
  const messageSafe =
    messagesOut !== command &&
    !MESSAGE_RISKS.test(messagesOut) &&
    !EXPANSION_AS_COMMAND.test(messagesOut)
  const base = messageSafe ? messagesOut : command
  const heredocsOut = stripDataHeredocs(base)
  const heredocSafe =
    heredocsOut !== base &&
    !hasCodeRunner(heredocsOut) &&
    !/\||<\(|>\(/.test(heredocsOut) &&
    !EXPANSION_AS_COMMAND.test(heredocsOut) &&
    !RUNS_WRITTEN_FILE.test(heredocsOut)
  return { effective: heredocSafe ? heredocsOut : base, inner: messageSafe ? inner : [] }
}
