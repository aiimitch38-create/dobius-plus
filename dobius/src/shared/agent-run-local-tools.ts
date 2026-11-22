// Which tool calls are known to stay on this Mac. An ALLOW list on purpose:
// anything not named here (a new connector, an unknown command, a script, an
// inline interpreter) counts as outward, and a run that used one is never
// retried. Pure; used by the run loop rules in agent-run-loop.ts.

// `Task` / `Agent` are deliberately absent: a subagent's own tool calls are
// not classified, so a run that delegated cannot be proven local.
const KNOWN_LOCAL_TOOLS: ReadonlySet<string> = new Set([
  'Read',
  'Write',
  'Edit',
  'Grep',
  'Glob',
  'TodoWrite',
  'NotebookEdit',
  'mcp__dobius__read_knowledge',
  'mcp__dobius__list_crew',
  'mcp__dobius__crew_status'
])

// Commands that only read or change local files, whatever their arguments.
// Left out because they can run other programs: sed, awk, xargs, env, make.
const LOCAL_COMMANDS: ReadonlySet<string> = new Set([
  'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'rg', 'find', 'pwd', 'echo', 'printf', 'true',
  'false', 'test', '[', 'which', 'file', 'stat', 'du', 'df', 'date', 'sort', 'uniq', 'cut', 'tr',
  'diff', 'basename', 'dirname', 'realpath', 'tree', 'jq', 'cd', 'mkdir', 'touch', 'cp', 'mv', 'rm'
])
// Arguments that make an otherwise local command run another program.
const EXECUTING_ARGS: Readonly<Record<string, readonly string[]>> = {
  find: ['-exec', '-execdir', '-ok', '-okdir'],
  rg: ['--pre', '--pre-glob', '--hostname-bin']
}

const LOCAL_GIT_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'status', 'diff', 'log', 'show', 'add', 'commit', 'branch', 'checkout', 'switch', 'restore',
  'stash', 'rev-parse', 'ls-files', 'blame', 'merge-base', 'describe', 'reset', 'rm', 'mv'
])

// Typecheck, test and lint tools, run directly or through a package-runner wrapper.
const LOCAL_CHECK_TOOLS: ReadonlySet<string> = new Set([
  'vitest', 'jest', 'tsc', 'tsgo', 'oxlint', 'oxfmt', 'eslint', 'prettier', 'biome', 'pytest',
  'ruff', 'mypy'
])
const PACKAGE_MANAGERS: ReadonlySet<string> = new Set(['npm', 'pnpm', 'yarn', 'bun'])
const LOCAL_SCRIPT_NAME = /^(?:test|typecheck|tc|lint|check|format)(?::[\w.-]+)*$/
// Package-manager flags that only choose the folder or package, each with one value.
const FOLDER_FLAGS: ReadonlySet<string> = new Set(['--dir', '-C', '--filter', '--prefix'])

// Only these folders may prefix a command name; `./ls` or `/tmp/git` is a
// script of unknown content, not the tool it is named after.
const TRUSTED_COMMAND_DIR =
  /^(?:\/bin\/|\/usr\/bin\/|\/usr\/local\/bin\/|\/opt\/homebrew\/bin\/|(?:\.\/)?node_modules\/\.bin\/)(?=[^/]+$)/

// Command substitution, process substitution and bash's network devices can
// hide a second command inside an allowed one.
const HIDDEN_COMMAND = /`|\$\(|<\(|>\(|\/dev\/(?:tcp|udp)\//

/**
 * Splits a shell command into its simple commands and their words, honouring
 * quotes. Returns null for anything it cannot read with certainty.
 */
function splitShellCommand(command: string): string[][] | null {
  const segments: string[][] = []
  let words: string[] = []
  let word = ''
  let inWord = false
  let quote: '"' | "'" | null = null
  const endWord = (): void => {
    if (inWord) {
      words.push(word)
    }
    word = ''
    inWord = false
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
        word += command[index]
      } else {
        word += char
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
      word += command[index]
      inWord = true
    } else if (char === '(' || char === ')' || char === '{' || char === '}') {
      // Subshells and groups.
      return null
    } else if (char === '&' && (command[index - 1] === '>' || command[index + 1] === '>')) {
      // Part of a redirection such as `2>&1`, not a command separator.
      word += char
      inWord = true
    } else if (char === ';' || char === '&' || char === '|' || char === '\n') {
      endSegment()
    } else if (char === ' ' || char === '\t' || char === '\r') {
      endWord()
    } else {
      word += char
      inWord = true
    }
  }
  if (quote) {
    return null
  }
  endSegment()
  return segments
}

function isLocalGit(args: string[]): boolean {
  let index = 0
  // `-c key=value` is refused: config can name a program for git to run.
  while (args[index] === '-C' || args[index] === '--no-pager') {
    index += args[index] === '-C' ? 2 : 1
  }
  return LOCAL_GIT_SUBCOMMANDS.has(args[index] ?? '')
}

function isLocalCheckTool(words: string[]): boolean {
  return LOCAL_CHECK_TOOLS.has(words[0]?.replace(TRUSTED_COMMAND_DIR, '') ?? '')
}

function isLocalPackageManagerCall(manager: string, args: string[]): boolean {
  let index = 0
  while (FOLDER_FLAGS.has(args[index] ?? '')) {
    index += 2
  }
  const [verb, ...rest] = args.slice(index)
  if (verb === 'run' || verb === 'run-script') {
    return LOCAL_SCRIPT_NAME.test(rest[0] ?? '')
  }
  if (verb === 'exec' || verb === 'dlx' || verb === 'x') {
    return isLocalCheckTool(rest)
  }
  // `npm <name>` is an npm command, not a script; the others run scripts by name.
  return manager === 'npm' ? verb === 'test' || verb === 't' : LOCAL_SCRIPT_NAME.test(verb ?? '')
}

function isLocalSimpleCommand(words: string[]): boolean {
  const name = words[0].replace(TRUSTED_COMMAND_DIR, '')
  const args = words.slice(1)
  if (name === 'git') {
    return isLocalGit(args)
  }
  if (PACKAGE_MANAGERS.has(name)) {
    return isLocalPackageManagerCall(name, args)
  }
  if (name === 'npx' || name === 'bunx') {
    return isLocalCheckTool(args)
  }
  if (name === 'uv') {
    return args[0] === 'run' && isLocalCheckTool(args.slice(1))
  }
  if (LOCAL_CHECK_TOOLS.has(name)) {
    return true
  }
  if (!LOCAL_COMMANDS.has(name)) {
    return false
  }
  const executing = EXECUTING_ARGS[name] ?? []
  return !args.some((arg) => executing.some((flag) => arg === flag || arg.startsWith(`${flag}=`)))
}

/**
 * True only when EVERY simple command in the line is on the known-local list.
 * Everything else is outward: unknown commands, scripts, inline interpreters
 * (`node -e`, `bash -c`), `env`/`FOO=bar` prefixes, subshells, `curl`, `ssh`,
 * `git push`, other `npm run` scripts.
 */
export function isLocalBashCommand(command: string): boolean {
  if (!command.trim() || HIDDEN_COMMAND.test(command)) {
    return false
  }
  const segments = splitShellCommand(command)
  return segments !== null && segments.length > 0 && segments.every(isLocalSimpleCommand)
}

// A `tool_progress` tick reuses the tool-use event with only an elapsed time
// ("12s"); the tool's real input was already judged on its own event.
const PROGRESS_TICK = /^\d+s$/

function bashCommandFromDetail(detail: string | undefined): string | null {
  if (!detail) {
    return null
  }
  try {
    const input: unknown = JSON.parse(detail)
    if (typeof input === 'object' && input !== null && 'command' in input) {
      const command = (input as { command: unknown }).command
      return typeof command === 'string' ? command : null
    }
    return null
  } catch {
    // Not the JSON a Bash call carries: the command cannot be read.
    return null
  }
}

/**
 * True only for a tool call known to stay on this Mac. Fails closed: an unknown
 * tool, or a Bash call whose command cannot be read, counts as outward.
 * `detail` is the tool-use event's detail (the tool input as JSON).
 */
export function isLocalOnlyToolUse(toolName: string | undefined, detail?: string): boolean {
  if (!toolName) {
    return false
  }
  if (toolName === 'Bash') {
    if (detail !== undefined && PROGRESS_TICK.test(detail)) {
      return true
    }
    const command = bashCommandFromDetail(detail)
    return command !== null && isLocalBashCommand(command)
  }
  return KNOWN_LOCAL_TOOLS.has(toolName)
}
