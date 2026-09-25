import path from 'node:path'
import { comparablePath } from '../communications/providers/protected-path-guard'

// Why this module exists (CX12 F6): the path rails match text, so a Bash
// command that assembles a path at run time (`d="$HOME/.do"; d="${d}bius/agents";
// cat "$d/other/MEMORY.md"`, `cat "$(printf '\x2e...')"`, `read d < file`) never
// shows the protected path to them. A deny-list of spellings cannot be complete,
// so a command whose paths depend on an expansion the rail cannot resolve is
// denied instead. What stays allowed: expansions of a few fixed environment
// variables used as whole words (`echo $PATH`) and `for` loop variables over
// literal relative words (`for f in *.ts; do wc -l "$f"; done`) when the run's
// working directory cannot reach ~/.dobius.
// Known residual (covered by the SDK sandbox build, SBX): globs such as
// `cat ~/.dob*/agents/*/MEMORY.md` and whole-home walkers (`find ~ | xargs cat`).

// Never under ~/.dobius; allowed unless used as a directory prefix (`$PATH/..`).
const SAFE_ENV_VARS = new Set(['PATH', 'SHELL', 'TERM', 'LANG', 'HOSTNAME', 'CI', 'NODE_ENV'])
// `$?` `$#` `$$` `$!` `$-` are numbers or flags, never paths.
const SPECIAL_PARAMETERS = new Set(['?', '#', '$', '!', '-'])

// `$((` is arithmetic (numbers only); `$(` and backticks are command substitution.
const EXPANSION = /\$\(\(|\$\(|`|\$\{([^}]*)\}?|\$([A-Za-z_][A-Za-z0-9_]*|[0-9@*?#$!-])/g
const WORD_BOUNDARY = /[\s;&|()<>=]/
const FOR_LOOP = /(?:^|[\s;&|(])for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([^;\n]*?)\s*(?:;|\n)\s*do\b/g
const DOT_DOT_SEGMENT = /(?:^|[\s/=:(<>])\.\.(?:\/|$|[\s;&|)<>])/

export const UNRESOLVABLE_SHELL_PATH_REASON =
  'Hard rail: this command builds a path from a shell variable or command substitution the rail cannot check against protected folders; write the paths out literally.'

export type ShellConstructionContext = {
  home: string
  // The run's current working directory, when the caller knows it.
  cwd?: string
}

type ExpandableText = {
  // Unquoted and double-quoted text: where `$` expansions happen.
  expanding: string
  // Unquoted text only: where brace expansion happens.
  unquoted: string
}

// What the shell would expand: single-quoted text and backslash-escaped
// characters are literal, so `awk '{print $1}'` is not an expansion. Quote
// characters are dropped so word boundaries match the shell's. Returns null for
// ANSI-C / locale quoting (`$'\x2e'`), which builds text from escapes.
function expandableText(command: string): ExpandableText | null {
  let expanding = ''
  let unquoted = ''
  let quote: '"' | "'" | null = null
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    if (quote === "'") {
      quote = char === "'" ? null : quote
    } else if (char === '\\') {
      index += 1
    } else if (char === '$' && quote === null && /['"]/.test(command[index + 1] ?? '')) {
      return null
    } else if (char === "'" && quote === null) {
      quote = "'"
    } else if (char === '"') {
      quote = quote === '"' ? null : '"'
    } else {
      expanding += char
      unquoted += quote === null ? char : ' '
    }
  }
  return { expanding, unquoted }
}

// CX12 F2 stopgaps: shell features that assemble a path from pieces the rail
// never sees whole.
const BRACE_EXPANSION = /\{[^{}\s]*(?:,|\.\.)[^{}\s]*\}/g
const NUMERIC_BRACE_WORD = /^\{-?\d+\.\.-?\d+(?:\.\.-?\d+)?\}$/
const WORD_CONTINUATION = /[^\s\\]\\\n[^\s]/
const XARGS_REPLACE = /\bxargs\b[^;&|\n]*\s-[A-Za-z]*[IJ]/
const MENTIONS_AGENTS = /agents\/|\.dob/i
const ANY_CD = /(?:^|[\s;&|(])(?:cd|pushd)(?:\s|$|[;&|)])/

function assemblesPathFromPieces(rawCommand: string, unquoted: string): boolean {
  if (WORD_CONTINUATION.test(rawCommand)) {
    return true
  }
  if (XARGS_REPLACE.test(rawCommand) && MENTIONS_AGENTS.test(rawCommand)) {
    return true
  }
  for (const match of unquoted.matchAll(BRACE_EXPANSION)) {
    const start = match.index ?? 0
    const word = `${wordPrefix(unquoted, start)}${match[0]}`
    const next = unquoted[start + match[0].length]
    const wholeWord = word === match[0] && (next === undefined || WORD_BOUNDARY.test(next))
    if (!(wholeWord && NUMERIC_BRACE_WORD.test(match[0]))) {
      return true
    }
  }
  return false
}

function isWithinOrEqual(root: string, candidate: string): boolean {
  const rootKey = comparablePath(root.replace(/\/+$/, ''))
  const candidateKey = comparablePath(candidate.replace(/\/+$/, ''))
  return candidateKey === rootKey || candidateKey.startsWith(`${rootKey}/`)
}

// Relative paths from here can name another agent's folder without the text
// `.dobius/agents` ever appearing (cwd = ~, or inside ~/.dobius).
function cwdReachesAgents(context: ShellConstructionContext): boolean {
  if (!context.cwd) {
    return true
  }
  const cwd = path.resolve(context.cwd)
  const dobiusRoot = path.join(context.home, '.dobius')
  return isWithinOrEqual(cwd, path.join(dobiusRoot, 'agents')) || isWithinOrEqual(dobiusRoot, cwd)
}

// Loop variables whose every word is a literal relative name: their values
// stay inside the working directory.
function safeLoopVariables(command: string): Set<string> {
  const names = new Set<string>()
  for (const match of command.matchAll(FOR_LOOP)) {
    const words = match[2].split(/\s+/).filter(Boolean)
    const literalRelative = words.every(
      (word) => !/[$`~]/.test(word) && !word.startsWith('/') && !DOT_DOT_SEGMENT.test(word)
    )
    if (literalRelative) {
      names.add(match[1])
    }
  }
  return names
}

function wordPrefix(command: string, start: number): string {
  let wordStart = start
  while (wordStart > 0 && !WORD_BOUNDARY.test(command[wordStart - 1])) {
    wordStart -= 1
  }
  return command.slice(wordStart, start)
}

// The command reaches outside its working directory toward home: a home or
// home-parent literal, `~`, `..`, or a `cd` whose target the rail cannot see.
function anchorsNearHome(command: string, home: string): boolean {
  const lowered = comparablePath(command)
  if (
    lowered.includes(comparablePath(home)) ||
    lowered.includes(comparablePath(`${path.dirname(home)}/`)) ||
    /(?:^|[\s=:(<>])~/.test(command) ||
    DOT_DOT_SEGMENT.test(command)
  ) {
    return true
  }
  return /(?:^|[;&|(\n])\s*(?:cd|pushd|popd)\s*(?:-\s*)?(?:$|[;&|)\n])/.test(command)
}

/**
 * True when `rawCommand` ($HOME/~ already expanded, quotes intact) uses a shell
 * expansion whose value the rail cannot resolve, so a protected path could be
 * assembled at run time.
 */
export function buildsUnresolvableShellPath(
  rawCommand: string,
  context: ShellConstructionContext
): boolean {
  const views = expandableText(rawCommand)
  if (views === null || assemblesPathFromPieces(rawCommand, views.unquoted)) {
    return true
  }
  const command = views.expanding
  if (/(?:^|[\s;&|(])eval(?:$|\s)/.test(command)) {
    return true
  }
  const loopVariables = cwdReachesAgents(context) ? new Set<string>() : safeLoopVariables(command)
  let usesLoopVariable = false
  for (const match of command.matchAll(EXPANSION)) {
    const [text, braced, bare] = match
    if (text === '$((') {
      continue
    }
    if (text === '$(' || text === '`') {
      return true
    }
    const name = braced === undefined ? bare : (/^[A-Za-z_][A-Za-z0-9_]*/.exec(braced)?.[0] ?? '')
    if (SPECIAL_PARAMETERS.has(name)) {
      continue
    }
    const start = match.index ?? 0
    const plain = braced === undefined || braced === name
    if (SAFE_ENV_VARS.has(name) && plain && command[start + text.length] !== '/') {
      continue
    }
    const usedAsPrefix = command[start + text.length] === '/'
    // Why (split-cd): after any `cd` the loop word's base directory is unknown.
    const splitCd = usedAsPrefix && ANY_CD.test(command)
    if (loopVariables.has(name) && !splitCd && !wordPrefix(command, start).startsWith('/')) {
      usesLoopVariable = true
      continue
    }
    return true
  }
  return usesLoopVariable && anchorsNearHome(command, context.home)
}
