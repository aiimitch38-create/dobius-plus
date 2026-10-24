// Goal wiring indexed by the console's terminal tab, across every board. Pure.
import type { BoardState } from '@/store/slices/board'
import { goalCards, goalTargetConsoles, type GoalCard } from './goal-targets'

export type ConsoleGoalWiring = {
  worktreeId: string
  tabId: string
  consoleName: string
  goals: GoalCard[]
}

export function goalWiringByTab(
  boardsByWorktree: Readonly<Record<string, BoardState>>
): Map<string, ConsoleGoalWiring> {
  const byTab = new Map<string, ConsoleGoalWiring>()
  for (const [worktreeId, board] of Object.entries(boardsByWorktree)) {
    for (const goal of goalCards(board)) {
      for (const c of goalTargetConsoles(board, goal.wiredCardIds)) {
        const entry = byTab.get(c.tabId) ?? {
          worktreeId,
          tabId: c.tabId,
          consoleName: c.title,
          goals: []
        }
        entry.goals.push(goal)
        byTab.set(c.tabId, entry)
      }
    }
  }
  return byTab
}
