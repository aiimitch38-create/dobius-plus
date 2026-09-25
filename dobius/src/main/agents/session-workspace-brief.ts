import { appendFileSync, lstatSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { writeFileAtomic } from '../storage/safe-json-file'
import {
  renderSessionWorkspaceBrief,
  WORKSPACE_BRIEF_FILENAME,
  WORKSPACE_BRIEF_MARKER,
  type WorkspaceContextPack
} from './session-workspace-brief-render'
import {
  collectSessionWorkspaceFacts,
  resolveWorkspaceRoot,
  runWorkspaceGit
} from './session-workspace-facts'

// Generates CLAUDE.local.md (Claude Code's per-checkout, uncommitted memory
// file) describing the session's worktree. Codex gets nothing: its
// AGENTS.override.md REPLACES the directory's AGENTS.md instead of adding to it.

export type WorkspaceBriefSkipReason =
  | 'not-a-git-worktree'
  | 'user-authored'
  | 'not-ignorable'
  | 'error'

export type WorkspaceBriefResult =
  | { status: 'written'; filePath: string }
  | { status: 'skipped'; reason: WorkspaceBriefSkipReason; filePath?: string }

export type WorkspaceContextPackProvider = (
  worktreeRoot: string
) => Promise<WorkspaceContextPack | null>

let adamUnavailableLogged = false

// Why: ADAM has no check-only context-pack route (BUILD-031: resolveContextPack
// is reachable only from its write routes), so there is nothing safe to call yet.
const unavailableAdamContextPack: WorkspaceContextPackProvider = async () => {
  if (!adamUnavailableLogged) {
    adamUnavailableLogged = true
    console.info(
      '[workspace-brief] ADAM context pack unavailable (no check-only route); using the checked-in feature map only'
    )
  }
  return null
}

export type SessionWorkspaceBriefDeps = {
  contextPack: WorkspaceContextPackProvider
  now: () => Date
}

const defaultDeps: SessionWorkspaceBriefDeps = {
  contextPack: unavailableAdamContextPack,
  now: () => new Date()
}

const inFlight = new Map<string, Promise<WorkspaceBriefResult>>()
const loggedUserAuthored = new Set<string>()

type ExistingBrief = 'absent' | 'generated' | 'user-authored'

function readExistingBrief(filePath: string): ExistingBrief {
  let stat: ReturnType<typeof lstatSync>
  try {
    stat = lstatSync(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return 'absent'
    }
    throw error
  }
  // Why: a symlink or directory at this name was put there by someone else.
  if (!stat.isFile()) {
    return 'user-authored'
  }
  return readFileSync(filePath, 'utf-8').startsWith(WORKSPACE_BRIEF_MARKER)
    ? 'generated'
    : 'user-authored'
}

// Why: the file must never be committed. Repos that do not already ignore it
// get a local-only rule in .git/info/exclude (shared by all worktrees, never
// pushed). If git cannot confirm the file is ignored, nothing is written.
async function ensureBriefIgnored(worktreeRoot: string): Promise<boolean> {
  const check = await runWorkspaceGit(worktreeRoot, [
    'check-ignore',
    '-q',
    '--',
    WORKSPACE_BRIEF_FILENAME
  ])
  if (check.ok) {
    return true
  }
  if (check.exitCode !== 1) {
    return false
  }
  const excludePath = await runWorkspaceGit(worktreeRoot, [
    'rev-parse',
    '--path-format=absolute',
    '--git-path',
    'info/exclude'
  ])
  if (!excludePath.ok || !excludePath.stdout.trim()) {
    return false
  }
  const target = excludePath.stdout.trim()
  mkdirSync(path.dirname(target), { recursive: true })
  appendFileSync(
    target,
    `\n# Dobius+ generated session workspace brief (local only)\n/${WORKSPACE_BRIEF_FILENAME}\n`
  )
  const recheck = await runWorkspaceGit(worktreeRoot, [
    'check-ignore',
    '-q',
    '--',
    WORKSPACE_BRIEF_FILENAME
  ])
  return recheck.ok
}

async function refreshBrief(
  cwd: string,
  deps: SessionWorkspaceBriefDeps
): Promise<WorkspaceBriefResult> {
  const root = await resolveWorkspaceRoot(cwd)
  if (!root) {
    return { status: 'skipped', reason: 'not-a-git-worktree' }
  }
  const filePath = path.join(root.worktreeRoot, WORKSPACE_BRIEF_FILENAME)
  if (readExistingBrief(filePath) === 'user-authored') {
    if (!loggedUserAuthored.has(filePath)) {
      loggedUserAuthored.add(filePath)
      console.info(`[workspace-brief] left ${filePath} alone: it is not a Dobius-generated file`)
    }
    return { status: 'skipped', reason: 'user-authored', filePath }
  }
  if (!(await ensureBriefIgnored(root.worktreeRoot))) {
    console.warn(`[workspace-brief] skipped ${filePath}: git could not confirm it is ignored`)
    return { status: 'skipped', reason: 'not-ignorable', filePath }
  }
  const [facts, contextPack] = await Promise.all([
    collectSessionWorkspaceFacts(root),
    deps.contextPack(root.worktreeRoot)
  ])
  // Why: re-check right before the write so a file the user created while the
  // facts were collected is still never overwritten.
  if (readExistingBrief(filePath) === 'user-authored') {
    return { status: 'skipped', reason: 'user-authored', filePath }
  }
  writeFileAtomic(filePath, renderSessionWorkspaceBrief(facts, deps.now(), contextPack))
  return { status: 'written', filePath }
}

// Never throws and never blocks longer than a few bounded git calls: a missing
// brief must not stop a terminal or agent run from starting.
export async function refreshSessionWorkspaceBrief(
  cwd: string,
  deps: SessionWorkspaceBriefDeps = defaultDeps
): Promise<WorkspaceBriefResult> {
  const key = path.resolve(cwd)
  const pending = inFlight.get(key)
  if (pending) {
    return pending
  }
  const run = refreshBrief(key, deps)
    .catch((error: unknown): WorkspaceBriefResult => {
      console.warn(
        `[workspace-brief] could not refresh the brief for ${key}: ${error instanceof Error ? error.message : String(error)}`
      )
      return { status: 'skipped', reason: 'error' }
    })
    .finally(() => {
      inFlight.delete(key)
    })
  inFlight.set(key, run)
  return run
}
