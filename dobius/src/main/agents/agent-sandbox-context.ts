import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getUserDataRoot } from '../storage/user-data-root'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { buildAgentRunSandboxPolicy } from './agent-sandbox-policy'

// Unset (tests, early boot) means on: the sandbox never defaults off.
let readAgentSandboxEnabled: () => boolean = () => true

/** Wired from main to the live `agentSandboxEnabled` setting (local Settings UI only). */
export function setAgentSandboxEnabledReader(reader: () => boolean): void {
  readAgentSandboxEnabled = reader
}

function isWithin(target: string, root: string): boolean {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function listDir(dir: string, label: string): string[] {
  try {
    return readdirSync(dir)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return []
    }
    // Fail closed: an unlistable folder must not start a run with holes in its policy.
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Agent sandbox: cannot list the ${label} (${detail})`)
  }
}

function scratchDirs(): string[] {
  const dirs = [os.tmpdir()]
  if (process.platform === 'darwin') {
    dirs.push('/tmp', '/private/tmp', '/private/var/folders')
  } else if (process.platform !== 'win32') {
    dirs.push('/tmp')
  }
  return [...new Set(dirs)]
}

// The repo top level and the git common dir; a linked worktree's commits
// write objects and refs into the main checkout's .git.
function repoDirs(cwd: string, home: string): string[] {
  let output: string
  try {
    output = execFileSync('git', ['rev-parse', '--show-toplevel', '--git-common-dir'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
  } catch {
    // Not a repo (or no git): only the cwd itself is writable.
    return []
  }
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => path.resolve(cwd, line))
    .filter((dir) => dir !== home && !isWithin(home, dir))
}

// The Claude CLI install (resolved through its launcher symlink) and every
// PATH folder, except folders that hold the run's own writable roots.
function executableDirs(
  claudeExecutable: string | undefined,
  writable: string[],
  projectDirs: string[]
): string[] {
  const dirs: string[] = []
  if (claudeExecutable && path.isAbsolute(claudeExecutable)) {
    dirs.push(path.dirname(claudeExecutable))
  }
  // A missing executable fails the spawn itself; its launcher dir is still protected.
  if (claudeExecutable && path.isAbsolute(claudeExecutable) && existsSync(claudeExecutable)) {
    const binDir = path.dirname(realpathSync(claudeExecutable))
    let root = binDir
    for (let depth = 0; depth < 3 && !existsSync(path.join(root, 'package.json')); depth++) {
      root = path.dirname(root)
    }
    dirs.push(existsSync(path.join(root, 'package.json')) ? root : binDir)
  }
  for (const entry of (process.env.PATH ?? '').split(path.delimiter)) {
    if (path.isAbsolute(entry)) {
      dirs.push(path.resolve(entry))
    }
  }
  // Why: protecting an ancestor of a writable root (or a tool dir inside the
  // project, like node_modules/.bin) would break the run's own writes.
  return [...new Set(dirs)].filter(
    (dir) =>
      !writable.some((root) => isWithin(root, dir)) &&
      !projectDirs.some((root) => isWithin(dir, root))
  )
}

export function resolveAgentRunSandboxPolicy(args: {
  agentId: string
  runProfile?: string
  cwd: string
  claudeConfigDir?: string | null
  claudeExecutable?: string
}): Pick<Options, 'sandbox' | 'disallowedTools'> {
  const homeDir = os.homedir()
  const dobiusDir = path.join(homeDir, '.dobius')
  const gitDirs = repoDirs(args.cwd, homeDir)
  const tempDirs = scratchDirs()
  const policy = buildAgentRunSandboxPolicy({
    agentId: args.agentId,
    runProfile: args.runProfile,
    homeDir,
    userDataDir: getUserDataRoot(),
    claudeConfigDir: args.claudeConfigDir,
    cwd: args.cwd,
    gitDirs,
    otherAgentEntries: listDir(path.join(dobiusDir, 'agents'), 'agents folder').filter(
      (entry) => entry !== args.agentId
    ),
    dobiusEntries: listDir(dobiusDir, 'Dobius folder').filter((entry) => entry !== 'agents'),
    tempDirs,
    executableDirs: executableDirs(
      args.claudeExecutable,
      [args.cwd, ...gitDirs, ...tempDirs],
      [args.cwd, ...gitDirs]
    )
  })
  if (readAgentSandboxEnabled()) {
    return policy
  }
  // Why: the switch drops only the kernel sandbox. The deny rules (protected
  // files, other agents, credentials, keychain) and the text rails stay on.
  console.warn(
    `[agents] Agent sandbox is OFF (Settings > Agents): run for agent ${args.agentId} is not ` +
      'kernel-sandboxed; its Bash commands can write anywhere in the home folder.'
  )
  return { disallowedTools: policy.disallowedTools }
}
