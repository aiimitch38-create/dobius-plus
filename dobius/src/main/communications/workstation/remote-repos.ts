// Backs the "no persisted clone required" half of workstation-git:
// get_project_repo_snapshot/diff preview an arbitrary cloneUrl+ref (e.g. a
// link shared in chat, before the viewer has added the project), and
// create/delete_project_remote_branch mutate a remote ref directly. Both use
// a small ephemeral cache clone under paths.ts's cache dir, keyed by a hash
// of the clone URL so two different URLs can never collide on disk.
import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { isGitRepo } from '../../git/repo'
import { assertNotFlagLike, runGit, runGitNetwork } from './git-exec'
import { defaultWorkstationCacheDir, resolveRemoteCachePath } from './paths'
import { buildRepoDiff, buildRepoSnapshot, type RawDiff, type RawSnapshot } from './repo-snapshot'

/** Ensures a local mirror of `cloneUrl` exists, returning its cache path. */
async function ensureRemoteCacheClone(cloneUrl: string): Promise<string> {
  assertNotFlagLike(cloneUrl, 'cloneUrl')
  const path = resolveRemoteCachePath(cloneUrl)
  if (!existsSync(path) || !isGitRepo(path)) {
    await mkdir(defaultWorkstationCacheDir(), { recursive: true })
    await runGitNetwork(['clone', '--no-checkout', '--', cloneUrl, path], defaultWorkstationCacheDir())
  }
  return path
}

/**
 * Fetches `ref` and resolves it to a commit SHA. Only the default branch
 * gets a durable local ref from `git clone` — any other branch exists only
 * as the transient FETCH_HEAD immediately after a fetch, so this captures
 * the SHA right away rather than passing the bare ref name to a later git
 * call, where it would no longer resolve to anything.
 */
async function fetchAndResolveRef(path: string, ref: string): Promise<string> {
  assertNotFlagLike(ref, 'ref')
  if (ref === 'HEAD') {
    await runGitNetwork(['fetch', 'origin'], path)
    return (await runGit(['rev-parse', 'FETCH_HEAD'], path)).stdout.trim()
  }
  try {
    await runGitNetwork(['fetch', 'origin', '--', ref], path)
    return (await runGit(['rev-parse', 'FETCH_HEAD'], path)).stdout.trim()
  } catch {
    // `ref` may already be a full commit SHA reachable from a prior fetch —
    // fall back to resolving it directly from what's already on disk.
    return (await runGit(['rev-parse', '--verify', ref], path)).stdout.trim()
  }
}

function resolveTargetRefName(input: {
  defaultBranch?: string | null
  baseBranch?: string | null
  targetRef?: string | null
  targetCommit?: string | null
}): string {
  const ref = input.targetCommit || input.targetRef || input.baseBranch || input.defaultBranch || 'HEAD'
  return assertNotFlagLike(ref, 'ref')
}

/** Snapshot of a repository by clone URL, at whichever ref the caller asked for — no persisted clone required. */
export async function getProjectRepoSnapshot(input: {
  cloneUrl: string
  defaultBranch?: string | null
  baseBranch?: string | null
  targetRef?: string | null
  targetCommit?: string | null
}): Promise<RawSnapshot> {
  const path = await ensureRemoteCacheClone(input.cloneUrl)
  const ref = resolveTargetRefName(input)
  const sha = await fetchAndResolveRef(path, ref)
  return buildRepoSnapshot(path, sha)
}

/** Diff for a repository by clone URL, between two refs — no persisted clone required. */
export async function getProjectRepoDiff(input: {
  cloneUrl: string
  defaultBranch?: string | null
  baseBranch?: string | null
  targetRef?: string | null
  targetCommit?: string | null
}): Promise<RawDiff> {
  const path = await ensureRemoteCacheClone(input.cloneUrl)
  const targetRefName = resolveTargetRefName(input)
  const baseRefName = assertNotFlagLike(input.baseBranch || input.defaultBranch || 'HEAD', 'baseBranch/defaultBranch')
  const targetSha = await fetchAndResolveRef(path, targetRefName)
  const baseSha = baseRefName === targetRefName ? targetSha : await fetchAndResolveRef(path, baseRefName)
  return buildRepoDiff(path, baseSha, targetSha, input.targetCommit ?? null)
}

export type RawBranchResult = { branch: string; commit: string; message: string }

/**
 * Creates `newBranch` on the remote pointing at `expectedCommit`, only if
 * `sourceBranch` currently resolves to that exact commit — an optimistic
 * concurrency check so a stale UI can't fork a branch off the wrong commit.
 */
export async function createProjectRemoteBranch(input: {
  cloneUrl: string
  sourceBranch: string
  expectedCommit: string
  newBranch: string
}): Promise<RawBranchResult> {
  assertNotFlagLike(input.cloneUrl, 'cloneUrl')
  assertNotFlagLike(input.sourceBranch, 'sourceBranch')
  assertNotFlagLike(input.expectedCommit, 'expectedCommit')
  assertNotFlagLike(input.newBranch, 'newBranch')

  // Why: `git push` needs to run inside an actual git repository (it has to
  // hold the commit OBJECT being pushed, not just know its SHA) — a bare
  // directory won't do, unlike ls-remote, which is remote-only.
  const path = await ensureRemoteCacheClone(input.cloneUrl)

  const { stdout } = await runGitNetwork(['ls-remote', '--', input.cloneUrl, `refs/heads/${input.sourceBranch}`], path)
  const actualCommit = stdout.trim().split(/\s+/)[0] ?? null
  if (!actualCommit || actualCommit !== input.expectedCommit) {
    throw new Error(
      `${input.sourceBranch} has moved (expected ${input.expectedCommit}, remote is at ${actualCommit ?? 'unknown'})`
    )
  }

  // Fetches expectedCommit's object into the local cache clone so the push
  // below has something to send.
  await fetchAndResolveRef(path, input.sourceBranch)
  await runGitNetwork(['push', '--', input.cloneUrl, `${input.expectedCommit}:refs/heads/${input.newBranch}`], path)
  return { branch: input.newBranch, commit: input.expectedCommit, message: `Created ${input.newBranch}` }
}

/** Deletes `branch` on the remote, only if it currently points at `expectedCommit`. */
export async function deleteProjectRemoteBranch(input: {
  cloneUrl: string
  branch: string
  expectedCommit: string
}): Promise<RawBranchResult> {
  assertNotFlagLike(input.cloneUrl, 'cloneUrl')
  assertNotFlagLike(input.branch, 'branch')
  assertNotFlagLike(input.expectedCommit, 'expectedCommit')

  const path = await ensureRemoteCacheClone(input.cloneUrl)

  const { stdout } = await runGitNetwork(['ls-remote', '--', input.cloneUrl, `refs/heads/${input.branch}`], path)
  const actualCommit = stdout.trim().split(/\s+/)[0] ?? null
  if (!actualCommit || actualCommit !== input.expectedCommit) {
    throw new Error(
      `${input.branch} has moved (expected ${input.expectedCommit}, remote is at ${actualCommit ?? 'unknown'})`
    )
  }

  await runGitNetwork(['push', '--', input.cloneUrl, `:refs/heads/${input.branch}`], path)
  return { branch: input.branch, commit: input.expectedCommit, message: `Deleted ${input.branch}` }
}
