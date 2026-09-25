import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getUserDataRoot } from '../storage/user-data-root'
import { buildAgentRunSandboxPolicy, type AgentRunSandboxPolicy } from './agent-sandbox-policy'

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
  cwd: string
  claudeConfigDir?: string | null
  claudeExecutable?: string
}): AgentRunSandboxPolicy {
  const homeDir = os.homedir()
  const dobiusDir = path.join(homeDir, '.dobius')
  const gitDirs = repoDirs(args.cwd, homeDir)
  const tempDirs = scratchDirs()
  return buildAgentRunSandboxPolicy({
    agentId: args.agentId,
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
}
