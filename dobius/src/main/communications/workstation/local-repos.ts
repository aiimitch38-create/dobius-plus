// Backs the "persisted local clone" half of workstation-git: a project's repo
// lives at <reposDir>/<projectDtag>, keyed by Buzz's own project identifier
// (not by any Dobius-tracked worktree/repo — this is a separate, simpler
// clone-on-demand store; see the coordinator brief's prior-analysis note).
import { mkdir, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { isGitRepo } from '../../git/repo'
import { assertNotFlagLike, runGit, runGitNetwork } from './git-exec'
import { resolveProjectLocalPath, resolveReposDir, WorkstationPathError } from './paths'
import { buildRepoDiff, buildRepoSnapshot, type RawDiff, type RawSnapshot } from './repo-snapshot'

export type CloneResult = { path: string; cloned: boolean; message: string }

async function currentBranch(cwd: string): Promise<string> {
  const { stdout } = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
  return stdout.trim()
}

/**
 * Resolves `ref` against a local clone. A plain `git clone` only creates a
 * local branch ref for the checked-out default branch — every other branch
 * exists solely as `refs/remotes/origin/<branch>` — so a bare `ref` that
 * names some other branch is retried as `origin/<ref>` before giving up.
 */
async function resolveLocalRef(cwd: string, ref: string): Promise<string> {
  assertNotFlagLike(ref, 'ref')
  return runGit(['rev-parse', '--verify', ref], cwd)
    .then((r) => r.stdout.trim())
    .catch(() =>
      runGit(['rev-parse', '--verify', `origin/${ref}`], cwd).then((r) => r.stdout.trim())
    )
}

/** Clones `cloneUrl` into `<reposDir>/<projectDtag>` if it isn't already there. Idempotent. */
export async function cloneProjectRepository(input: {
  reposDir?: string | null
  projectDtag: string
  cloneUrl: string
  defaultBranch?: string | null
}): Promise<CloneResult> {
  assertNotFlagLike(input.cloneUrl, 'cloneUrl')
  const root = resolveReposDir(input.reposDir)
  const path = resolveProjectLocalPath(input.reposDir, input.projectDtag)

  if (existsSync(path)) {
    if (!isGitRepo(path)) {
      throw new Error(`${path} exists and is not a git repository`)
    }
    return { path, cloned: false, message: 'Repository already cloned' }
  }

  await mkdir(root, { recursive: true })
  const args = ['clone', '--', input.cloneUrl, path]
  if (input.defaultBranch) {
    assertNotFlagLike(input.defaultBranch, 'defaultBranch')
    args.splice(1, 0, '--branch', input.defaultBranch)
  }
  await runGitNetwork(args, root)
  return { path, cloned: true, message: `Cloned into ${path}` }
}

export type RawLocalRepository = { name: string; path: string }

/** Lists every project repository already cloned under reposDir. */
export async function listProjectLocalRepositories(input: {
  reposDir?: string | null
}): Promise<RawLocalRepository[]> {
  const root = resolveReposDir(input.reposDir)
  if (!existsSync(root)) {return []}
  const entries = await readdir(root, { withFileTypes: true })
  const repos: RawLocalRepository[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) {continue}
    const path = resolveProjectLocalPath(input.reposDir, entry.name)
    if (isGitRepo(path)) {repos.push({ name: entry.name, path })}
  }
  return repos
}

export type RawLocalSnapshot = { path: string; snapshot: RawSnapshot } | null

/** Snapshot of an already-cloned local project repository. Null if it hasn't been cloned yet. */
export async function getProjectLocalRepoSnapshot(input: {
  reposDir?: string | null
  projectDtag: string
  cloneUrl?: string | null
  defaultBranch?: string | null
  baseBranch?: string | null
}): Promise<RawLocalSnapshot> {
  const path = resolveProjectLocalPath(input.reposDir, input.projectDtag)
  if (!existsSync(path) || !isGitRepo(path)) {return null}
  const ref = input.baseBranch || input.defaultBranch || 'HEAD'
  const sha = await resolveLocalRef(path, ref)
  const snapshot = await buildRepoSnapshot(path, sha)
  return { path, snapshot }
}

/** Diff for an already-cloned local project repository. Null if it hasn't been cloned yet. */
export async function getProjectLocalRepoDiff(input: {
  reposDir?: string | null
  projectDtag: string
  cloneUrl?: string | null
  defaultBranch?: string | null
  baseBranch?: string | null
  baseCommit?: string | null
  targetCommit?: string | null
}): Promise<RawDiff | null> {
  const path = resolveProjectLocalPath(input.reposDir, input.projectDtag)
  if (!existsSync(path) || !isGitRepo(path)) {return null}
  const baseRef = input.baseCommit || input.baseBranch || input.defaultBranch || 'HEAD'
  const targetRef = input.targetCommit || 'HEAD'
  const [baseSha, targetSha] = await Promise.all([resolveLocalRef(path, baseRef), resolveLocalRef(path, targetRef)])
  return buildRepoDiff(path, baseSha, targetSha, input.targetCommit ?? null)
}

export type RawSyncStatus = {
  local_path: string | null
  local_branch: string | null
  local_branches: string[]
  local_head: string | null
  local_short_head: string | null
  remote_branch: string | null
  remote_head: string | null
  remote_short_head: string | null
  merge_base: string | null
  ahead_count: number
  behind_count: number
  has_uncommitted_changes: boolean
  has_untracked_files: boolean
  can_push: boolean
  push_block_reason: string | null
  can_pull: boolean
  pull_block_reason: string | null
}

async function readLocalBranches(cwd: string): Promise<string[]> {
  const { stdout } = await runGit(['branch', '--format=%(refname:short)'], cwd)
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

async function readPorcelainFlags(cwd: string): Promise<{ dirty: boolean; untracked: boolean }> {
  const { stdout } = await runGit(['status', '--porcelain'], cwd)
  const lines = stdout.split('\n').filter(Boolean)
  return {
    dirty: lines.some((line) => !line.startsWith('??')),
    untracked: lines.some((line) => line.startsWith('??'))
  }
}

/** Real ahead/behind/dirty status computed by fetching the remote branch and diffing local vs. remote-tracking heads. */
export async function getProjectRepoSyncStatus(input: {
  reposDir?: string | null
  projectDtag: string
  cloneUrl: string
  branchName?: string | null
  baseBranch?: string | null
}): Promise<RawSyncStatus> {
  assertNotFlagLike(input.cloneUrl, 'cloneUrl')
  const path = resolveProjectLocalPath(input.reposDir, input.projectDtag)
  if (!existsSync(path) || !isGitRepo(path)) {
    return {
      local_path: null,
      local_branch: null,
      local_branches: [],
      local_head: null,
      local_short_head: null,
      remote_branch: null,
      remote_head: null,
      remote_short_head: null,
      merge_base: null,
      ahead_count: 0,
      behind_count: 0,
      has_uncommitted_changes: false,
      has_untracked_files: false,
      can_push: false,
      push_block_reason: 'No local clone',
      can_pull: false,
      pull_block_reason: 'No local clone'
    }
  }

  const branch = input.branchName ? assertNotFlagLike(input.branchName, 'branchName') : await currentBranch(path)
  const [localBranches, { dirty, untracked }, localHead, localShortHead] = await Promise.all([
    readLocalBranches(path),
    readPorcelainFlags(path),
    runGit(['rev-parse', branch], path)
      .then((r) => r.stdout.trim())
      .catch(() => null),
    runGit(['rev-parse', '--short', branch], path)
      .then((r) => r.stdout.trim())
      .catch(() => null)
  ])

  let remoteHead: string | null = null
  let remoteBranch: string | null = null
  try {
    await runGitNetwork(['fetch', 'origin', '--', branch], path)
    remoteHead = (await runGit(['rev-parse', 'FETCH_HEAD'], path)).stdout.trim()
    remoteBranch = `origin/${branch}`
  } catch {
    // No matching remote branch yet — first push scenario, not an error.
  }

  let mergeBase: string | null = null
  let aheadCount = 0
  let behindCount = 0
  if (localHead && remoteHead) {
    mergeBase = await runGit(['merge-base', localHead, remoteHead], path)
      .then((r) => r.stdout.trim())
      .catch(() => null)
    const counts = await runGit(['rev-list', '--left-right', '--count', `${localHead}...${remoteHead}`], path)
      .then((r) => r.stdout.trim().split(/\s+/))
      .catch(() => ['0', '0'])
    aheadCount = Number.parseInt(counts[0] ?? '0', 10) || 0
    behindCount = Number.parseInt(counts[1] ?? '0', 10) || 0
  }

  const canPush = remoteHead === null ? true : aheadCount > 0 && behindCount === 0
  const pushBlockReason =
    remoteHead === null
      ? null
      : aheadCount === 0
        ? 'Nothing to push'
        : behindCount > 0
          ? 'Branch has diverged from remote — pull before pushing'
          : null
  const canPull = remoteHead !== null && behindCount > 0 && !dirty
  const pullBlockReason =
    remoteHead === null
      ? 'No remote branch to pull from'
      : behindCount === 0
        ? 'Already up to date'
        : dirty
          ? 'Uncommitted local changes would be overwritten'
          : null

  return {
    local_path: path,
    local_branch: branch,
    local_branches: localBranches,
    local_head: localHead,
    local_short_head: localShortHead,
    remote_branch: remoteBranch,
    remote_head: remoteHead,
    remote_short_head: remoteHead ? remoteHead.slice(0, 7) : null,
    merge_base: mergeBase,
    ahead_count: aheadCount,
    behind_count: behindCount,
    has_uncommitted_changes: dirty,
    has_untracked_files: untracked,
    can_push: canPush,
    push_block_reason: pushBlockReason,
    can_pull: canPull,
    pull_block_reason: pullBlockReason
  }
}

export type RawPushResult = { pushed: boolean; message: string; branch: string; commit: string; merge_base: string | null }

async function ensureOrigin(cwd: string, cloneUrl: string): Promise<void> {
  assertNotFlagLike(cloneUrl, 'cloneUrl')
  try {
    const { stdout } = await runGit(['remote', 'get-url', 'origin'], cwd)
    if (stdout.trim() !== cloneUrl) {
      await runGit(['remote', 'set-url', 'origin', '--', cloneUrl], cwd)
    }
  } catch {
    await runGit(['remote', 'add', 'origin', '--', cloneUrl], cwd)
  }
}

/** Pushes the local project repository's branch to origin (real `git push`). */
export async function pushProjectLocalRepository(input: {
  reposDir?: string | null
  projectDtag: string
  cloneUrl: string
  branchName?: string | null
  baseBranch?: string | null
}): Promise<RawPushResult> {
  const path = resolveProjectLocalPath(input.reposDir, input.projectDtag)
  if (!existsSync(path) || !isGitRepo(path)) {
    throw new Error('No local clone to push — clone the repository first')
  }
  await ensureOrigin(path, input.cloneUrl)
  const branch = input.branchName ? assertNotFlagLike(input.branchName, 'branchName') : await currentBranch(path)
  await runGitNetwork(['push', '--set-upstream', 'origin', `${branch}:${branch}`], path)
  const commit = (await runGit(['rev-parse', 'HEAD'], path)).stdout.trim()
  let mergeBase: string | null = null
  if (input.baseBranch) {
    mergeBase = await runGit(['merge-base', assertNotFlagLike(input.baseBranch, 'baseBranch'), 'HEAD'], path)
      .then((r) => r.stdout.trim())
      .catch(() => null)
  }
  return { pushed: true, message: `Pushed ${branch} to origin`, branch, commit, merge_base: mergeBase }
}

export type RawPullResult = { pulled: boolean; message: string }

/** Pulls the latest changes for the local project repository's branch (real `git pull`). */
export async function pullProjectLocalRepository(input: {
  reposDir?: string | null
  projectDtag: string
  cloneUrl: string
  branchName?: string | null
}): Promise<RawPullResult> {
  const path = resolveProjectLocalPath(input.reposDir, input.projectDtag)
  if (!existsSync(path) || !isGitRepo(path)) {
    throw new Error('No local clone to pull — clone the repository first')
  }
  await ensureOrigin(path, input.cloneUrl)
  const branch = input.branchName ? assertNotFlagLike(input.branchName, 'branchName') : await currentBranch(path)
  await runGitNetwork(['pull', 'origin', '--', branch], path)
  return { pulled: true, message: `Pulled origin/${branch}` }
}

/** Test-only helper: removes a project's local clone directory entirely. */
export async function removeProjectLocalRepositoryForTests(input: {
  reposDir?: string | null
  projectDtag: string
}): Promise<void> {
  const path = resolveProjectLocalPath(input.reposDir, input.projectDtag)
  await rm(path, { recursive: true, force: true })
}

export { WorkstationPathError }
