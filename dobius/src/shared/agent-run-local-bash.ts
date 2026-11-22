// Is a Bash command known to stay on this Mac? An ALLOW list on purpose: a
// line is local only when EVERY simple command in it is named here. Unknown
// commands, scripts, inline interpreters (`node -e`, `bash -c`), `env` /
// `FOO=bar` prefixes, subshells, `curl`, `ssh`, `git push` and other
// `npm run` scripts all count as outward.

import { readShellCommand, type ShellSimpleCommand } from './agent-run-shell-words'

export type BashVerdict = {
  local: boolean
  /** Runs code from the project: git (hooks, config), a package script, a check tool. */
  runsProjectCode: boolean
  /** Names a path that decides what those tools run (.git, node_modules, package.json, tool config). */
  touchesToolingPath: boolean
}

const OUTWARD: BashVerdict = { local: false, runsProjectCode: false, touchesToolingPath: false }

// Commands that only read or change local files. Left out because they run
// other programs or load code: sed, awk, xargs, env, make, rg, tee, sh.
const READ_COMMANDS: ReadonlySet<string> = new Set([
  'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'find', 'pwd', 'echo', 'printf', 'true', 'false',
  'test', '[', 'which', 'file', 'stat', 'du', 'df', 'date', 'sort', 'uniq', 'cut', 'tr', 'diff',
  'basename', 'dirname', 'realpath', 'tree', 'jq'
])
const WRITE_COMMANDS: ReadonlySet<string> = new Set(['cd', 'mkdir', 'touch', 'cp', 'mv', 'rm'])

// Arguments that make an otherwise local command run another program. Long
// options also match by prefix, because GNU tools accept `--compress-p`.
const EXECUTING_ARGS: Readonly<Record<string, readonly string[]>> = {
  find: ['-exec', '-execdir', '-ok', '-okdir'],
  sort: ['--compress-program'],
  git: ['--upload-pack', '--receive-pack', '--exec', '--ext-diff', '--textconv', '--open-files-in-pager']
}

const QUIET_GIT_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'status', 'diff', 'log', 'show', 'add', 'branch', 'rev-parse', 'ls-files', 'blame', 'merge-base',
  'describe', 'reset', 'rm', 'mv'
])
// These run the repository's hooks, so they are local only with hooks switched off.
const HOOK_GIT_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'commit', 'checkout', 'switch', 'restore', 'stash'
])
const HOOKS_OFF = 'core.hooksPath=/dev/null'

// Typecheck, test and lint tools, run directly or through a package-runner wrapper.
const CHECK_TOOLS: ReadonlySet<string> = new Set([
  'vitest', 'jest', 'tsc', 'tsgo', 'oxlint', 'oxfmt', 'eslint', 'prettier', 'biome', 'pytest',
  'ruff', 'mypy'
])
const PACKAGE_MANAGERS: ReadonlySet<string> = new Set(['npm', 'pnpm', 'yarn', 'bun'])
const CHECK_SCRIPT_NAME = /^(?:test|typecheck|tc|lint|check|format)(?::[\w.-]+)*$/
// Package-manager flags that only choose the folder or package, each with one value.
const FOLDER_FLAGS: ReadonlySet<string> = new Set(['--dir', '-C', '--filter', '--prefix'])

// Only system folders may prefix a command name. `./ls`, `/tmp/git` and
// `node_modules/.bin/tsc` are files of unknown content, not the tool they are named after.
const SYSTEM_COMMAND_DIR = /^(?:\/bin\/|\/usr\/bin\/|\/usr\/local\/bin\/|\/opt\/homebrew\/bin\/)(?=[^/]+$)/

const PLAIN_FILE_PATH = /^[\w@%+=:,.~/-]+$/
const TOOLING_DIR = /(?:^|\/)(?:\.git|\.husky|node_modules)(?:\/|$)/
// package.json, lockfiles, `*.config.*`, tsconfig and the named tool configs.
const TOOLING_FILE =
  /^(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|uv\.lock|poetry\.lock|\.npmrc|\.yarnrc(?:\.yml)?|\.pnpmfile\.cjs|pnpm-workspace\.yaml|conftest\.py|pyproject\.toml|setup\.(?:py|cfg)|tox\.ini|pytest\.ini|mypy\.ini|\.?ruff\.toml|biome\.jsonc?|\.gitattributes|\.gitmodules|.+\.config\.[\w.]+|\.?(?:vitest|jest|vite|eslint|oxlint|oxfmt|prettier|babel|tsconfig|jsconfig)[\w.-]*)$/

/** True for a path that decides what git, the package manager or a check tool runs. */
export function isToolingPath(filePath: string): boolean {
  const normalized = filePath.replaceAll('\\', '/')
  return TOOLING_DIR.test(normalized) || TOOLING_FILE.test(normalized.split('/').at(-1) ?? '')
}

function hasExecutingArg(name: string, args: string[]): boolean {
  const flags = EXECUTING_ARGS[name] ?? []
  return args.some((arg) => {
    const option = arg.split('=')[0]
    return flags.some(
      (flag) => option === flag || (option.length > 2 && option.startsWith('--') && flag.startsWith(option))
    )
  })
}

// Device files (`/dev/tcp/host/port` is a network socket in bash) are never a
// plain local path; `/dev/null` is the one harmless exception.
function namesDevice(word: string): boolean {
  return word !== '/dev/null' && word !== HOOKS_OFF && word.includes('/dev/')
}

// Read commands that can also write a file. Which file is not worked out: any
// use counts as a possible change to the tooling files.
function mayWriteFile(name: string, args: string[]): boolean {
  if (name === 'find') {
    return args.some((arg) => arg === '-delete' || arg.startsWith('-fprint') || arg === '-fls')
  }
  if (name === 'sort' || name === 'tree') {
    return args.some((arg) =>
      arg.startsWith('--') ? '--output'.startsWith(arg.split('=')[0]) : /^-\w*o/.test(arg)
    )
  }
  // `uniq in out` writes its second file.
  return name === 'uniq' && args.some(isToolingPath)
}

function isLocalGit(args: string[]): boolean {
  let index = 0
  let hooksOff = false
  // Any other `-c key=value` is refused: config can name a program for git to run.
  while (args[index] === '-C' || args[index] === '--no-pager' || args[index] === '-c') {
    if (args[index] === '-c') {
      if (args[index + 1] !== HOOKS_OFF) {
        return false
      }
      hooksOff = true
    }
    index += args[index] === '--no-pager' ? 1 : 2
  }
  const subcommand = args[index] ?? ''
  if (hasExecutingArg('git', args.slice(index + 1))) {
    return false
  }
  return QUIET_GIT_SUBCOMMANDS.has(subcommand) || (hooksOff && HOOK_GIT_SUBCOMMANDS.has(subcommand))
}

function isCheckTool(words: string[]): boolean {
  return CHECK_TOOLS.has(words[0] ?? '')
}

function isLocalPackageManagerCall(manager: string, args: string[]): boolean {
  let index = 0
  while (FOLDER_FLAGS.has(args[index] ?? '')) {
    index += 2
  }
  const [verb, ...rest] = args.slice(index)
  if (verb === 'run' || verb === 'run-script') {
    return CHECK_SCRIPT_NAME.test(rest[0] ?? '')
  }
  if (verb === 'exec' || verb === 'dlx' || verb === 'x') {
    return isCheckTool(rest)
  }
  // `npm <name>` is an npm command, not a script; the others run scripts by name.
  return manager === 'npm' ? verb === 'test' || verb === 't' : CHECK_SCRIPT_NAME.test(verb ?? '')
}

function judgeSimpleCommand(command: ShellSimpleCommand): BashVerdict {
  const name = command.words[0].replace(SYSTEM_COMMAND_DIR, '')
  const args = command.words.slice(1)
  if (
    command.words.some(namesDevice) ||
    command.redirectTargets.some((target) => namesDevice(target) || !PLAIN_FILE_PATH.test(target))
  ) {
    return OUTWARD
  }
  const writesTooling = command.redirectTargets.some(isToolingPath)
  if (name === 'git') {
    return { local: isLocalGit(args), runsProjectCode: true, touchesToolingPath: writesTooling }
  }
  const runsCheck =
    (PACKAGE_MANAGERS.has(name) && isLocalPackageManagerCall(name, args)) ||
    ((name === 'npx' || name === 'bunx') && isCheckTool(args)) ||
    (name === 'uv' && args[0] === 'run' && isCheckTool(args.slice(1))) ||
    CHECK_TOOLS.has(name)
  if (runsCheck) {
    return { local: true, runsProjectCode: true, touchesToolingPath: writesTooling }
  }
  if (WRITE_COMMANDS.has(name)) {
    return {
      local: true,
      runsProjectCode: false,
      touchesToolingPath: writesTooling || args.some(isToolingPath)
    }
  }
  if (!READ_COMMANDS.has(name) || hasExecutingArg(name, args)) {
    return OUTWARD
  }
  return {
    local: true,
    runsProjectCode: false,
    touchesToolingPath: writesTooling || mayWriteFile(name, args)
  }
}

export function judgeBashCommand(command: string): BashVerdict {
  const commands = readShellCommand(command)
  if (!commands) {
    return OUTWARD
  }
  const verdicts = commands.map(judgeSimpleCommand)
  if (!verdicts.every((verdict) => verdict.local)) {
    return OUTWARD
  }
  return {
    local: true,
    runsProjectCode: verdicts.some((verdict) => verdict.runsProjectCode),
    touchesToolingPath: verdicts.some((verdict) => verdict.touchesToolingPath)
  }
}

export function isLocalBashCommand(command: string): boolean {
  return judgeBashCommand(command).local
}
