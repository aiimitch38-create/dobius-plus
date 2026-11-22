import { isAbsolute, relative, resolve as resolvePath } from 'node:path'
import { isPathInsideOrEqual } from '../shared/cross-platform-path'
import { getRepoExecutionHostId, LOCAL_EXECUTION_HOST_ID } from '../shared/execution-host'
import type { RuntimeRepoList, RuntimeWorktreeRecord } from '../shared/runtime-types'
import type { RuntimeClient } from './runtime-client'

function isWithinPath(parentPath: string, childPath: string): boolean {
  if (isPathInsideOrEqual(parentPath, childPath)) {
    return true
  }
  const relativePath = relative(parentPath, childPath)
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

// Why: a cwd is a path on this machine, so a worktree on an SSH or runtime host
// whose remote path happens to match must never be picked for it. Older records
// carry no hostId; then the owning repo's connection decides, and repo.list is
// fetched only in that case.
export async function localWorktreesContaining(
  worktrees: RuntimeWorktreeRecord[],
  currentPath: string,
  client: RuntimeClient
): Promise<RuntimeWorktreeRecord[]> {
  const explicit = worktrees.filter(
    (worktree) =>
      (worktree.hostId === undefined || worktree.hostId === LOCAL_EXECUTION_HOST_ID) &&
      isWithinPath(resolvePath(worktree.path), currentPath)
  )
  if (explicit.every((worktree) => worktree.hostId !== undefined)) {
    return explicit
  }
  const repos = await client.call<RuntimeRepoList>('repo.list')
  const repoHost = new Map(
    repos.result.repos.map((repo) => [repo.id, getRepoExecutionHostId(repo)])
  )
  return explicit.filter(
    (worktree) =>
      (worktree.hostId ?? repoHost.get(worktree.repoId) ?? LOCAL_EXECUTION_HOST_ID) ===
      LOCAL_EXECUTION_HOST_ID
  )
}
