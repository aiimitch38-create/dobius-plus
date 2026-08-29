import { realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'

/**
 * Classification for one shell command Adam wants to run.
 *
 * `read-only` runs immediately, `writing` is queued for a human click in the
 * review window, `denied` never runs at any approval level.
 */
export type ShellVerdict =
  | { verdict: 'read-only' }
  | { verdict: 'writing' }
  | { verdict: 'denied'; reason: string }

export type ClassifyOptions = {
  /** Absolute path of `userData/adam-plugins`, when it is known. */
  pluginDir?: string
  /** Injected in tests; matches the resolver shape used by `self-edit.ts`. */
  realpath?: (path: string) => string
}

/**
 * Commands that only report. Matched on the leading binary and only when that
 * binary is a bare name — see `hasPathSeparator` for why.
 *
 * `osascript` is deliberately absent: "get only" is not decidable from an argv,
 * and `osascript -e 'do shell script "…" with administrator privileges'`
 * escalates to root. It goes through the approval window like any other write.
 */
const READ_ONLY_BINARIES = new Set([
  'ls',
  'cat',
  'head',
  'tail',
  'wc',
  'df',
  'du',
  'ps',
  'vm_stat',
  'sw_vers',
  'uptime',
  'date',
  'echo',
  'which',
  'pgrep',
  'grep',
  'find',
  'networksetup',
  'system_profiler'
])

/** Never runnable, whatever the user clicks. */
const DENIED_BINARIES = new Set([
  'sudo',
  'su',
  'dd',
  'mkfs',
  'diskutil',
  'shutdown',
  'reboot',
  'halt',
  'killall',
  'launchctl',
  'csrutil',
  'spctl',
  'security',
  'chown'
])

/** `find` predicates that run or write something instead of just listing. */
const FIND_EXECUTING_PREDICATES = new Set([
  '-delete',
  '-exec',
  '-execdir',
  '-ok',
  '-okdir',
  '-fprint',
  '-fprint0',
  '-fprintf',
  '-fls'
])

/**
 * Flags that redirect a tool's output into a file.
 *
 * None of the allowlisted binaries has one today; this is defence in depth
 * against a tool whose flag set was mis-assessed. `find`'s `-o` is excluded
 * because there it is the documented OR operator, and find has its own rules.
 */
const OUTPUT_FILE_FLAGS = new Set(['-o', '-O', '--output', '--output-file'])

/** Directories where a recursive permission change is unrecoverable. */
const SYSTEM_ROOTS = new Set([
  '/',
  '/System',
  '/usr',
  '/bin',
  '/sbin',
  '/Library',
  '/Applications',
  '/etc',
  '/var',
  '/private',
  '/opt'
])

const RECURSIVE_FLAGS = new Set(['-R', '-r', '--recursive'])

/** The folder name plugins live in; blocked as a path segment anywhere. */
export const ADAM_PLUGINS_DIR_NAME = 'adam-plugins'

/**
 * The one definition of where plugins live.
 *
 * Why a function rather than each caller joining the name itself: the shell
 * tool, the self-edit resolver and the loader must all mean the SAME folder. If
 * one of them drifts, the deny rules stop covering the folder the loader
 * actually reads and invariant B silently opens. `agent-context.ts:12-18`
 * records this codebase getting burned by exactly that kind of drift.
 */
export function adamPluginDir(userDataPath: string): string {
  return join(userDataPath, ADAM_PLUGINS_DIR_NAME)
}

function hasPathSeparator(binary: string): boolean {
  return binary.includes('/') || binary.includes('\\')
}

function isFlag(token: string): boolean {
  return token.startsWith('-')
}

function realpathOr(path: string, realpath: (p: string) => string): string {
  try {
    return realpath(path)
  } catch {
    // A path that does not exist yet still has a meaningful lexical form.
    return resolve(path)
  }
}

/**
 * True when a token names a location inside the plugin directory.
 *
 * Two checks on purpose: the segment test catches every literal spelling of the
 * path without needing to know where userData is, and the containment test
 * catches a path that reaches the same folder by a different route. Either one
 * alone leaves a hole; together the folder stays unreachable.
 */
function touchesPluginDir(
  token: string,
  pluginDir?: string,
  realpath: (path: string) => string = realpathSync
): boolean {
  if (token.split(/[\\/]/).includes(ADAM_PLUGINS_DIR_NAME)) {
    return true
  }
  if (!pluginDir || !isAbsolute(token)) {
    return false
  }
  // Why realpath the PARENT rather than the token: the token is usually a file
  // about to be created, so it does not exist yet and cannot be resolved — but
  // the directory the write lands in does. Checking the lexical path alone left
  // invariant B open, because a symlink anywhere on the machine pointing at the
  // plugin folder reads as an innocuous path in the approval window and still
  // drops unsigned code into the folder. `self-edit.ts` resolves links for the
  // same reason.
  const root = realpathOr(pluginDir, realpath)
  const target = join(realpathOr(dirname(resolve(token)), realpath), basename(token))
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`
  return target === root || target.startsWith(rootPrefix)
}

function deniesChmod(argv: readonly string[]): boolean {
  if (!argv.slice(1).some((token) => RECURSIVE_FLAGS.has(token))) {
    return false
  }
  return argv.slice(1).some((token) => !isFlag(token) && SYSTEM_ROOTS.has(resolve(token)))
}

/**
 * Arguments that turn an allowlisted, reporting command into one that runs or
 * writes something. Anything matched here falls through to the approval window
 * rather than the immediate-execution path.
 */
function escalatesToWriting(argv: readonly string[]): boolean {
  const [binary, ...args] = argv
  if (args.some((token) => token === 'xargs' || token.endsWith('/xargs'))) {
    return true
  }
  if (binary === 'find' && args.some((token) => FIND_EXECUTING_PREDICATES.has(token))) {
    return true
  }
  return args.some((token) => {
    if (binary === 'find' && token === '-o') {
      return false
    }
    const flag = token.split('=')[0]
    return OUTPUT_FILE_FLAGS.has(flag)
  })
}

/**
 * Decides what may happen to a command.
 *
 * Execution is `execFile` with this argv array — never a shell — so `>`, `|`,
 * `;`, `&&` and `$(…)` arrive at the binary as ordinary literal arguments and
 * cannot redirect, chain, or substitute anything. That is why this function can
 * stay a list of names rather than a shell parser.
 */
export function classifyShellCommand(
  argv: readonly string[],
  options: ClassifyOptions = {}
): ShellVerdict {
  const [binary] = argv
  if (!binary || !binary.trim()) {
    return { verdict: 'denied', reason: 'No command given.' }
  }

  for (const token of argv) {
    if (touchesPluginDir(token, options.pluginDir, options.realpath)) {
      return {
        verdict: 'denied',
        reason: 'The Adam plugin folder is off limits — plugins are installed by hand.'
      }
    }
  }

  const name = binary.split(/[\\/]/).pop() ?? binary
  if (DENIED_BINARIES.has(name) || name.startsWith('mkfs')) {
    return { verdict: 'denied', reason: `"${name}" is never allowed, approved or not.` }
  }
  if (name === 'chmod' && deniesChmod(argv)) {
    return {
      verdict: 'denied',
      reason: 'A recursive permission change on a system directory is never allowed.'
    }
  }

  // A binary reached by path is not the allowlisted one: /tmp/evil/ls would
  // otherwise inherit ls's entry by basename. Path invocations need approval.
  if (hasPathSeparator(binary)) {
    return { verdict: 'writing' }
  }
  if (!READ_ONLY_BINARIES.has(name) || escalatesToWriting(argv)) {
    return { verdict: 'writing' }
  }
  return { verdict: 'read-only' }
}
