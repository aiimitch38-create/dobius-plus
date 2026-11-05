import type { DobiusClient, DobiusRepo, DobiusWorktree } from '../adapters/dobius.js'

type PreflightClient = Pick<DobiusClient, 'repoShow' | 'worktreeList' | 'repoSearchRefs'>

export type WorkspaceMode = 'existing_terminal' | 'fresh_agent_current_worktree' | 'isolated_new_worktree' | 'independent_full_handoff'

export type WorkerPreflight = {
  repo: DobiusRepo
  baseRef: string
  baseRefSource: 'repo_upstream' | 'main_ref' | 'master_ref' | 'main_worktree'
  worktrees: DobiusWorktree[]
  workspaceMode: WorkspaceMode
  rationale: string
}

export class WorkerPreflightPlanner {
  constructor(private readonly dobius: PreflightClient) {}

  async plan(input: {
    repoSelector: string
    needsCurrentUncommittedState?: boolean
    existingTerminalHandle?: string
    fullHandoff?: boolean
    reviewOnly?: boolean
  }): Promise<WorkerPreflight> {
    const { repo } = await this.dobius.repoShow(input.repoSelector)
    const worktrees = (await this.dobius.worktreeList(`id:${repo.id}`, 100)).worktrees
    const base = await this.resolveBase(repo, worktrees)
    if (input.existingTerminalHandle) {
      return { repo, ...base, worktrees, workspaceMode: 'existing_terminal', rationale: 'The request explicitly targets an existing terminal.' }
    }
    if (input.needsCurrentUncommittedState || input.reviewOnly) {
      return {
        repo, ...base, worktrees, workspaceMode: 'fresh_agent_current_worktree',
        rationale: input.reviewOnly
          ? 'Review work should inspect the named current state without creating an unrelated checkout.'
          : 'The task depends on current uncommitted state, so a fresh agent must remain in that worktree.'
      }
    }
    return {
      repo, ...base, worktrees,
      workspaceMode: input.fullHandoff ? 'independent_full_handoff' : 'isolated_new_worktree',
      rationale: input.fullHandoff
        ? 'Ownership transfers to an independent worker based on the repository default base.'
        : 'Independent implementation receives an isolated worktree based on the repository default base.'
    }
  }

  private async resolveBase(repo: DobiusRepo, worktrees: DobiusWorktree[]): Promise<Pick<WorkerPreflight, 'baseRef' | 'baseRefSource'>> {
    if (repo.upstream) return { baseRef: String(repo.upstream), baseRefSource: 'repo_upstream' }
    for (const candidate of ['main', 'master']) {
      const result = await this.dobius.repoSearchRefs(`id:${repo.id}`, candidate, 20)
      const refs = (result.refs ?? []) as string[]
      if (refs.includes(candidate)) {
        return { baseRef: candidate, baseRefSource: candidate === 'main' ? 'main_ref' : 'master_ref' }
      }
    }
    const main = worktrees.find((worktree) => worktree.isMainWorktree && worktree.branch)
    if (!main?.branch) throw new Error('No safe default base ref could be resolved')
    return { baseRef: String(main.branch).replace(/^refs\/heads\//, ''), baseRefSource: 'main_worktree' }
  }
}
