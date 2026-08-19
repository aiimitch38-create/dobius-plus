import { existsSync } from 'node:fs'
import { isGitRepo } from '../../git/repo'
import { assertNotFlagLike, runGit, runGitNetwork } from './git-exec'
import { resolveProjectLocalPath } from './paths'
import { cloneProjectRepository } from './local-repos'
import { openNativeTerminalAt } from './terminal-launch'

export type ProjectTerminalResult = { path: string; cloned: boolean }

/** Ensures a project has a local clone, then opens a terminal at its path. */
export async function openProjectTerminal(input: {
  reposDir?: string | null
  projectDtag: string
  cloneUrl?: string | null
  defaultBranch?: string | null
}): Promise<ProjectTerminalResult> {
  const path = resolveProjectLocalPath(input.reposDir, input.projectDtag)
  let cloned = false
  if (!existsSync(path) || !isGitRepo(path)) {
    if (!input.cloneUrl) {
      throw new Error('No local clone exists and no cloneUrl was provided to create one')
    }
    const result = await cloneProjectRepository({
      reposDir: input.reposDir,
      projectDtag: input.projectDtag,
      cloneUrl: input.cloneUrl,
      defaultBranch: input.defaultBranch
    })
    cloned = result.cloned
  }
  await openNativeTerminalAt(path)
  return { path, cloned }
}

export type MergeRecoveryResult = {
  path: string
  cloned: boolean
  recoveryRef: string
  targetRef: string
}

const RECOVERY_TARGET_REF = 'refs/dobius/merge-recovery/target'
const RECOVERY_BRANCH_PREFIX = 'dobius/merge-recovery'

/**
 * Prepares a local checkout for manual conflict resolution: fetches the
 * target branch (verifying it is still at `expectedCommit`), fetches the
 * source branch from its own remote, attempts the merge, and opens a
 * terminal there. A merge conflict here is the expected outcome, not a
 * failure — that's the whole reason this recovery flow exists — so a
 * non-zero `git merge` exit is swallowed and left for the user to resolve.
 */
export async function openProjectMergeRecoveryTerminal(input: {
  reposDir?: string | null
  projectDtag: string
  targetCloneUrl: string
  sourceCloneUrl: string
  targetBranch: string
  sourceBranch: string
  expectedCommit: string
}): Promise<MergeRecoveryResult> {
  assertNotFlagLike(input.targetCloneUrl, 'targetCloneUrl')
  assertNotFlagLike(input.sourceCloneUrl, 'sourceCloneUrl')
  assertNotFlagLike(input.targetBranch, 'targetBranch')
  assertNotFlagLike(input.sourceBranch, 'sourceBranch')
  assertNotFlagLike(input.expectedCommit, 'expectedCommit')

  const path = resolveProjectLocalPath(input.reposDir, input.projectDtag)
  let cloned = false
  if (!existsSync(path) || !isGitRepo(path)) {
    const result = await cloneProjectRepository({
      reposDir: input.reposDir,
      projectDtag: input.projectDtag,
      cloneUrl: input.targetCloneUrl,
      defaultBranch: input.targetBranch
    })
    cloned = result.cloned
  }

  try {
    await runGit(['remote', 'set-url', 'origin', '--', input.targetCloneUrl], path)
  } catch {
    await runGit(['remote', 'add', 'origin', '--', input.targetCloneUrl], path)
  }
  await runGitNetwork(['fetch', 'origin', '--', input.targetBranch], path)
  const targetHead = (await runGit(['rev-parse', 'FETCH_HEAD'], path)).stdout.trim()
  if (targetHead !== input.expectedCommit) {
    throw new Error(
      `${input.targetBranch} has moved (expected ${input.expectedCommit}, remote is at ${targetHead})`
    )
  }
  await runGit(['update-ref', RECOVERY_TARGET_REF, targetHead], path)

  await runGitNetwork(['fetch', '--', input.sourceCloneUrl, input.sourceBranch], path)
  const sourceHead = (await runGit(['rev-parse', 'FETCH_HEAD'], path)).stdout.trim()

  const recoveryBranch = `${RECOVERY_BRANCH_PREFIX}/${Date.now()}`
  await runGit(['checkout', '-B', recoveryBranch, targetHead], path)
  await runGit(['merge', '--no-ff', '--no-commit', sourceHead], path).catch(() => {
    // Conflicts are the expected outcome — the terminal below is where the
    // user resolves them, not this call.
  })

  await openNativeTerminalAt(path)
  return { path, cloned, recoveryRef: `refs/heads/${recoveryBranch}`, targetRef: RECOVERY_TARGET_REF }
}
