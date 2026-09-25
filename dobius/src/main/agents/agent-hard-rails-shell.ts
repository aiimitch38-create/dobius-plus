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

export const SHELL_SEGMENT_SEPARATOR = /&&|\|\||[;|&\n()`]/

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

export const UNVERIFIABLE_PUSH_REASON =
  'Hard rail: git push with shell variables, command substitution, preceding assignments or -c overrides cannot be checked for force; write the push out literally.'

export type ShellConstructionContext = {
  home: string
  // The run's current working directory, when the caller knows it.
  cwd?: string
}

// What the shell would expand: single-quoted text and backslash-escaped
// characters are literal, so `awk '{print $1}'` is not an expansion. Quote
// characters are dropped so word boundaries match the shell's. Returns null for
// ANSI-C / locale quoting (`$'\x2e'`), which builds text from escapes.
function expandableText(command: string): string | null {
  let text = ''
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
      text += char
    }
  }
  return text
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
  const command = expandableText(rawCommand)
  if (command === null || /(?:^|[\s;&|(])eval(?:$|\s)/.test(command)) {
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
    if (loopVariables.has(name) && !wordPrefix(command, start).startsWith('/')) {
      usesLoopVariable = true
      continue
    }
    return true
  }
  return usesLoopVariable && anchorsNearHome(command, context.home)
}

// Why: flags belong to the command in their own shell segment only, so
// `git push && rm -rf dist` must not read rm's `-rf` as a push flag. Global
// options can sit between git and push (`git -C <path> push --force`).
export function isForcePush(command: string): boolean {
  for (const segment of command.split(SHELL_SEGMENT_SEPARATOR)) {
    const tokens = segment
      .trim()
      .split(/\s+/)
      .map((token) => token.replace(/^["']|["']$/g, ''))
    const gitIndex = tokens.findIndex((token) => token === 'git' || token.endsWith('/git'))
    const pushIndex = gitIndex === -1 ? -1 : tokens.indexOf('push', gitIndex + 1)
    if (pushIndex !== -1 && tokens.slice(pushIndex + 1).some(isForcePushArgument)) {
      return true
    }
  }
  return false
}

// `+branch` is refspec-syntax force-push — same rail as --force / -f.
function isForcePushArgument(token: string): boolean {
  return token.startsWith('--force') || /^-[A-Za-z]*f[A-Za-z]*$/.test(token) || /^\+\S/.test(token)
}

// Both only in command position, so `find . -name x` or `-m a=b` do not count.
const ASSIGNMENT_WORD =
  /(?:^|[;&|(\n])\s*(?:env\s+|export\s+|declare\s+|local\s+|readonly\s+|typeset\s+)?[A-Za-z_][A-Za-z0-9_]*\+?=/
const VARIABLE_SETTER =
  /(?:^|[;&|(\n])\s*(?:read|readarray|mapfile|export|declare|typeset|local|eval|source|\.|alias)(?:$|\s)/

/**
 * CX12 F7: `F=--force; git push "$F"` hides the flag in a variable. A push whose
 * segment holds an expansion or escape, in a command with command substitution,
 * an assignment or a variable setter (a variable or GIT_CONFIG_* env could supply
 * `--force` or a `+` refspec), or that passes a `-c` override cannot be verified
 * as non-force.
 */
export function isUnverifiablePush(command: string): boolean {
  const pushSegments = command.split(SHELL_SEGMENT_SEPARATOR).flatMap((segment) => {
    const tokens = segment
      .trim()
      .split(/\s+/)
      .map((token) => token.replace(/^["']|["']$/g, ''))
    const gitIndex = tokens.findIndex((token) => token === 'git' || token.endsWith('/git'))
    const pushIndex = gitIndex === -1 ? -1 : tokens.indexOf('push', gitIndex + 1)
    return pushIndex === -1 ? [] : [{ segment, globals: tokens.slice(gitIndex + 1, pushIndex) }]
  })
  if (pushSegments.length === 0) {
    return false
  }
  if (/\$\(|`/.test(command) || ASSIGNMENT_WORD.test(command) || VARIABLE_SETTER.test(command)) {
    return true
  }
  return pushSegments.some(
    ({ segment, globals }) =>
      /[$\\]/.test(segment) ||
      globals.some((token) => token === '-c' || token.startsWith('--config-env'))
  )
}
