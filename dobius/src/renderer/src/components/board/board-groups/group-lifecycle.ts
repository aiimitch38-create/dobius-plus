import { closeTerminalTab } from '@/components/terminal/terminal-tab-actions'
import { useAppStore } from '@/store'
import { getBoard, type BoardState } from '@/store/slices/board'

/** Console cards in a group and the terminal tabs they own. */
export function planGroupDelete(
  board: BoardState,
  groupId: string
): { cardIds: string[]; tabIds: string[] } {
  const members = new Set(board.groups.find((g) => g.id === groupId)?.cardIds ?? [])
  const consoles = board.cards.flatMap((c) =>
    c.kind === 'console' && members.has(c.id) ? [c] : []
  )
  return { cardIds: consoles.map((c) => c.id), tabIds: consoles.map((c) => c.tabId) }
}

/** "@Team A" style address for a group, matching main's slug rule. */
export function groupAddress(name: string): string {
  return `@${name
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '-')}`
}

export function ungroupBoardGroup(worktreeId: string, groupId: string): void {
  useAppStore.getState().dissolveGroup(worktreeId, groupId)
}

// Why: deleting a group ends its agents; non-console members (notes, docs) stay on the board.
export function deleteBoardGroupAndConsoles(worktreeId: string, groupId: string): void {
  const state = useAppStore.getState()
  const plan = planGroupDelete(getBoard(state, worktreeId), groupId)
  for (const tabId of plan.tabIds) {
    closeTerminalTab(tabId)
  }
  state.removeCards(worktreeId, plan.cardIds)
  state.dissolveGroup(worktreeId, groupId)
}
