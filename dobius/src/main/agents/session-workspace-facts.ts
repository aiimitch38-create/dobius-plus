import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { checkExecutionAdmission } from './execution-gate'
import { DOBIUS_REPO_IDENTITY_PATH } from './session-workspace-feature-map'

// Why: the brief is generated on the agent-start path; a hung git (network
// filesystem, huge repo) must cost at most this long per call, never block a run.
export const WORKSPACE_GIT_TIMEOUT_MS = 1500

export type WorkspaceGitResult =
  | { ok: true; stdout: string }
  | { ok: false; exitCode: number | null }

export type WorkspaceDirtyState = { tracked: number; untracked: number } | 'unknown'

export type WorkspaceGateState = 'running' | 'paused' | 'control-state-unreadable'

export type SessionWorkspaceFacts = {
  worktreeRoot: string
  repoName: string
  isLinkedWorktree: boolean
  branch: string | null
  headShort: string | null
  dirty: WorkspaceDirtyState
  gate: WorkspaceGateState
  isDobiusRepo: boolean
  packageManager: 'pnpm' | 'yarn' | 'npm' | null
  packageScripts: string[]
}

export type WorkspaceRootInfo = {
  worktreeRoot: string
  commonDir: string
  gitDir: string
}

export function runWorkspaceGit(cwd: string, args: string[]): Promise<WorkspaceGitResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      {
        cwd,
        encoding: 'utf-8',
        timeout: WORKSPACE_GIT_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
        // Why: status must not take the index lock out from under the user's own git commands.
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
      },
      (error, stdout) => {
        if (!error) {
          resolve({ ok: true, stdout })
          return
        }
        const code = (error as NodeJS.ErrnoException & { code?: unknown }).code
        resolve({ ok: false, exitCode: typeof code === 'number' ? code : null })
      }
    )
  })
}

export async function resolveWorkspaceRoot(cwd: string): Promise<WorkspaceRootInfo | null> {
  const result = await runWorkspaceGit(cwd, [
    'rev-parse',
    '--path-format=absolute',
    '--show-toplevel',
    '--git-common-dir',
    '--git-dir'
  ])
  if (!result.ok) {
    return null
  }
  const [worktreeRoot, commonDir, gitDir] = result.stdout.split('\n').map((line) => line.trim())
  if (!worktreeRoot || !commonDir || !gitDir) {
    return null
  }
  return { worktreeRoot, commonDir, gitDir }
}

function parseDirtyState(result: WorkspaceGitResult): WorkspaceDirtyState {
  if (!result.ok) {
    return 'unknown'
  }
  let tracked = 0
  let untracked = 0
  for (const line of result.stdout.split('\n')) {
    if (!line) {
      continue
    }
    if (line.startsWith('??')) {
      untracked += 1
    } else {
      tracked += 1
    }
  }
  return { tracked, untracked }
}

function readGateState(): WorkspaceGateState {
  const admission = checkExecutionAdmission('agent-run')
  return admission.allowed ? 'running' : admission.reason
}

const SCRIPT_NAME_PATTERN = /^(build|test|typecheck|lint)(:[\w:-]+)?$/
const MAX_LISTED_SCRIPTS = 12

// Only script NAMES leave this function: script bodies can embed env values.
function readPackageScripts(worktreeRoot: string): string[] {
  const manifestPath = path.join(worktreeRoot, 'package.json')
  if (!existsSync(manifestPath)) {
    return []
  }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as { scripts?: unknown }
    if (!manifest.scripts || typeof manifest.scripts !== 'object') {
      return []
    }
    return Object.keys(manifest.scripts)
      .filter((name) => SCRIPT_NAME_PATTERN.test(name))
      .slice(0, MAX_LISTED_SCRIPTS)
  } catch (error) {
    console.warn(
      `[workspace-brief] could not read scripts from ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`
    )
    return []
  }
}

function detectPackageManager(worktreeRoot: string): SessionWorkspaceFacts['packageManager'] {
  if (existsSync(path.join(worktreeRoot, 'pnpm-lock.yaml'))) {
    return 'pnpm'
  }
  if (existsSync(path.join(worktreeRoot, 'yarn.lock'))) {
    return 'yarn'
  }
  return existsSync(path.join(worktreeRoot, 'package.json')) ? 'npm' : null
}

export async function collectSessionWorkspaceFacts(
  root: WorkspaceRootInfo
): Promise<SessionWorkspaceFacts> {
  const { worktreeRoot, commonDir, gitDir } = root
  const [branchResult, headResult, statusResult] = await Promise.all([
    runWorkspaceGit(worktreeRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
    runWorkspaceGit(worktreeRoot, ['rev-parse', '--short', 'HEAD']),
    runWorkspaceGit(worktreeRoot, ['status', '--porcelain=v1', '--untracked-files=normal'])
  ])
  const isDobiusRepo = existsSync(path.join(worktreeRoot, DOBIUS_REPO_IDENTITY_PATH))
  const repoName =
    path.basename(commonDir) === '.git'
      ? path.basename(path.dirname(commonDir))
      : path.basename(worktreeRoot)
  return {
    worktreeRoot,
    repoName,
    isLinkedWorktree: path.resolve(commonDir) !== path.resolve(gitDir),
    branch: branchResult.ok ? branchResult.stdout.trim() || null : null,
    headShort: headResult.ok ? headResult.stdout.trim() || null : null,
    dirty: parseDirtyState(statusResult),
    gate: readGateState(),
    isDobiusRepo,
    packageManager: isDobiusRepo ? null : detectPackageManager(worktreeRoot),
    packageScripts: isDobiusRepo ? [] : readPackageScripts(worktreeRoot)
  }
}
