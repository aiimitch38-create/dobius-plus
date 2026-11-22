import { closeTerminalTab } from '@/components/terminal/terminal-tab-actions'
import { useAppStore } from '@/store'
import { getBoard, type BoardCard } from '@/store/slices/board'
import { boardCardsWithClosedTabs, type BoardKillTarget } from './board-kill-targets'

// How long a close keeps watching pinned tabs still waiting on their own confirm.
const PINNED_CLOSE_WAIT_MS = 2 * 60 * 1000

export type BoardResetPlan = {
  /** Consoles: their terminal is closed first; the card goes once the tab is gone. */
  consoles: BoardKillTarget[]
  /** Everything else (web tiles, notes, docs, shapes…): removed at once. */
  otherCardIds: string[]
}

export function boardResetPlan(cards: readonly BoardCard[]): BoardResetPlan {
  const consoles: BoardKillTarget[] = []
  const otherCardIds: string[] = []
  for (const card of cards) {
    if (card.kind === 'console') {
      consoles.push({ cardId: card.id, tabId: card.tabId })
    } else {
      otherCardIds.push(card.id)
    }
  }
  return { consoles, otherCardIds }
}

/**
 * Closes each console's terminal, then removes the card once its tab is really
 * gone. Why: a pinned tab asks for its own confirmation and may be kept, so a
 * live terminal is never left without its card.
 */
export function closeConsoleCards(
  worktreeId: string,
  targets: readonly BoardKillTarget[],
  options?: { stayOnBoard?: boolean }
): void {
  // Snapshot first: closing tabs changes the store mid-loop.
  const snapshot = [...targets]
  for (const target of snapshot) {
    // Never forced: a pinned console still asks for its own confirmation.
    closeTerminalTab(target.tabId, { keepWorktreeActive: options?.stayOnBoard === true })
  }
  const sweep = (): boolean => {
    const state = useAppStore.getState()
    const closed = boardCardsWithClosedTabs(snapshot, state.tabsByWorktree)
    state.removeCards(worktreeId, closed)
    return closed.length === snapshot.length
  }
  if (sweep()) {
    return
  }
  const unsubscribe = useAppStore.subscribe((state, prev) => {
    if (state.tabsByWorktree !== prev.tabsByWorktree && sweep()) {
      stop()
    }
  })
  const timer = setTimeout(() => stop(), PINNED_CLOSE_WAIT_MS)
  const stop = (): void => {
    unsubscribe()
    clearTimeout(timer)
  }
}

/** Clears one workspace's board: every console (terminal closed) and every other card. */
export function resetBoard(worktreeId: string): void {
  const state = useAppStore.getState()
  const plan = boardResetPlan(getBoard(state, worktreeId).cards)
  // Groups and connectors empty out with their cards (removeCards prunes them).
  state.removeCards(worktreeId, plan.otherCardIds)
  // Why: closing a workspace's last terminal normally switches to an open file
  // or browser tab, or deactivates the workspace (which drops the user on
  // Home). Reset means "an empty board", so the close leaves all of that
  // alone, including for a pinned console confirmed later.
  closeConsoleCards(worktreeId, plan.consoles, { stayOnBoard: true })
}
