import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync
} from 'node:fs'
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
  runWorkspaceGit,
  type WorkspaceRootInfo
} from './session-workspace-facts'

// Generates CLAUDE.local.md (Claude Code's per-checkout, uncommitted memory
// file) describing the session's worktree. Codex gets nothing: its
// AGENTS.override.md REPLACES the directory's AGENTS.md instead of adding to it.

export type WorkspaceBriefSkipReason =
  | 'not-a-git-worktree'
  | 'user-authored'
  | 'not-ignorable'
  | 'nested-worktrees'
  | 'recently-refreshed'
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

// Why: agent runs in one worktree can start back to back; a brief this fresh
// is still accurate enough, so scheduled refreshes skip the git work.
export const WORKSPACE_BRIEF_REFRESH_TTL_MS = 60_000

const EXCLUDE_RULE = `/${WORKSPACE_BRIEF_FILENAME}`

// All keyed by worktree root, so different cwds inside one worktree share them.
const inFlight = new Map<string, Promise<WorkspaceBriefResult>>()
const lastWrittenAt = new Map<string, number>()
// Why: a root whose ignore rules defeat ours (a `!CLAUDE.local.md` re-include,
// or a tracked file) would otherwise get the exclude rule appended on every run.
const notIgnorableRoots = new Set<string>()
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
// pushed), added at most once. If git cannot confirm the file is ignored,
// nothing is written.
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
  const existing = existsSync(target) ? readFileSync(target, 'utf-8') : ''
  if (existing.split(/\r?\n/).some((line) => line.trim() === EXCLUDE_RULE)) {
    return false
  }
  mkdirSync(path.dirname(target), { recursive: true })
  appendFileSync(
    target,
    `\n# Dobius+ generated session workspace brief (local only)\n${EXCLUDE_RULE}\n`
  )
  const recheck = await runWorkspaceGit(worktreeRoot, [
    'check-ignore',
    '-q',
    '--',
    WORKSPACE_BRIEF_FILENAME
  ])
  return recheck.ok
}

function canonicalPath(target: string): string {
  try {
    return realpathSync(target)
  } catch {
    // A worktree registered in git whose folder is gone still counts by its recorded path.
    return path.resolve(target)
  }
}

// Why: Claude Code loads every CLAUDE.local.md from the cwd up to the root, so a
// brief at a main checkout would leak into sessions of worktrees nested below it
// (Dobius keeps them under .claude/worktrees/) with the wrong branch and path.
async function hasNestedLinkedWorktrees(root: WorkspaceRootInfo): Promise<boolean> {
  const list = await runWorkspaceGit(root.worktreeRoot, ['worktree', 'list', '--porcelain'])
  if (!list.ok) {
    return true
  }
  const base = canonicalPath(root.worktreeRoot)
  return list.stdout
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => canonicalPath(line.slice('worktree '.length)))
    .some((worktreePath) => worktreePath !== base && worktreePath.startsWith(base + path.sep))
}

async function refreshBrief(
  root: WorkspaceRootInfo,
  deps: SessionWorkspaceBriefDeps
): Promise<WorkspaceBriefResult> {
  const filePath = path.join(root.worktreeRoot, WORKSPACE_BRIEF_FILENAME)
  if (notIgnorableRoots.has(root.worktreeRoot)) {
    return { status: 'skipped', reason: 'not-ignorable', filePath }
  }
  if (readExistingBrief(filePath) === 'user-authored') {
    if (!loggedUserAuthored.has(filePath)) {
      loggedUserAuthored.add(filePath)
      console.info(`[workspace-brief] left ${filePath} alone: it is not a Dobius-generated file`)
    }
    return { status: 'skipped', reason: 'user-authored', filePath }
  }
  if (root.commonDir === root.gitDir && (await hasNestedLinkedWorktrees(root))) {
    return { status: 'skipped', reason: 'nested-worktrees', filePath }
  }
  if (!(await ensureBriefIgnored(root.worktreeRoot))) {
    notIgnorableRoots.add(root.worktreeRoot)
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
  const now = deps.now()
  writeFileAtomic(filePath, renderSessionWorkspaceBrief(facts, now, contextPack))
  lastWrittenAt.set(root.worktreeRoot, now.getTime())
  return { status: 'written', filePath }
}

async function refreshForCwd(
  cwd: string,
  deps: SessionWorkspaceBriefDeps,
  honorTtl: boolean
): Promise<WorkspaceBriefResult> {
  try {
    const root = await resolveWorkspaceRoot(path.resolve(cwd))
    if (!root) {
      return { status: 'skipped', reason: 'not-a-git-worktree' }
    }
    const key = root.worktreeRoot
    const writtenAt = lastWrittenAt.get(key)
    if (
      honorTtl &&
      writtenAt !== undefined &&
      deps.now().getTime() - writtenAt < WORKSPACE_BRIEF_REFRESH_TTL_MS
    ) {
      return { status: 'skipped', reason: 'recently-refreshed' }
    }
    const pending = inFlight.get(key)
    if (pending) {
      return await pending
    }
    const run = refreshBrief(root, deps).finally(() => {
      inFlight.delete(key)
    })
    inFlight.set(key, run)
    return await run
  } catch (error) {
    console.warn(
      `[workspace-brief] could not refresh the brief for ${cwd}: ${error instanceof Error ? error.message : String(error)}`
    )
    return { status: 'skipped', reason: 'error' }
  }
}

// Awaited on worktree creation so the first session there already has the
// brief. Never throws; only a few bounded git calls.
export function refreshSessionWorkspaceBrief(
  cwd: string,
  deps: SessionWorkspaceBriefDeps = defaultDeps
): Promise<WorkspaceBriefResult> {
  return refreshForCwd(cwd, deps, false)
}

// Fire-and-forget for agent runs: SDK runs do not load CLAUDE.local.md
// themselves, so they must not wait on git; this only keeps the file current
// for later terminal sessions. Returns the promise for tests; never rejects.
export function scheduleSessionWorkspaceBriefRefresh(
  cwd: string,
  deps: SessionWorkspaceBriefDeps = defaultDeps
): Promise<WorkspaceBriefResult> {
  return refreshForCwd(cwd, deps, true)
}
