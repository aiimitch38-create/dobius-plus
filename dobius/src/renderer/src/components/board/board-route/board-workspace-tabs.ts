import type { BoardWorkspaceTab } from '../board-chrome/BoardTopBar'

export type BoardWorkspaceSource = {
  id: string
  displayName: string
  branch: string
  isArchived: boolean
  sortOrder: number
}

function branchLabel(branch: string): string {
  return branch.replace(/^refs\/heads\//, '')
}

/** Active-repo worktrees as Board tabs; count = console cards on that worktree's board. */
export function boardWorkspaceTabs(
  worktrees: readonly BoardWorkspaceSource[],
  consoleCountByWorktree: Readonly<Record<string, number>>
): BoardWorkspaceTab[] {
  return worktrees
    .filter((w) => !w.isArchived)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((w) => ({
      id: w.id,
      name: w.displayName.trim() || branchLabel(w.branch) || w.id,
      count: consoleCountByWorktree[w.id] ?? 0
    }))
}
