import { getBoard, type BoardSlice } from '@/store/slices/board'

/** What the terminal layer does with a tab whose last pane's PTY exited. */
export type PtyExitOutcome = 'keep-pane' | 'close-tab'

/**
 * Why: a Board console card must outlive its agent process. Classic closes the
 * tab when its only PTY exits; on the Board that left the card reading
 * "Terminal closed" with the output gone. Keeping the dead pane mounted shows
 * the scrollback, the status chip reads "Ended", and Restart relaunches in place.
 */
export function boardConsolePtyExitOutcome(
  state: Pick<BoardSlice, 'boardsByWorktree'>,
  worktreeId: string,
  tabId: string
): PtyExitOutcome {
  const owned = getBoard(state, worktreeId).cards.some(
    (card) => card.kind === 'console' && card.tabId === tabId
  )
  return owned ? 'keep-pane' : 'close-tab'
}

// Why: the keep-pane path above leaves a tab with no PTY, which is also what a
// tab that is still spawning looks like. Remember which tabs ended so the
// lifecycle helpers (clean board) can tell the two apart.
const endedTabs = new Set<string>()

export function markBoardConsoleEnded(tabId: string): void {
  endedTabs.add(tabId)
}

/** True when this tab's last PTY exited under a Board console card (and no PTY replaced it). */
export function isBoardConsoleEnded(tabId: string): boolean {
  return endedTabs.has(tabId)
}

export function clearBoardConsoleEnded(tabId: string): void {
  endedTabs.delete(tabId)
}

export function resetBoardConsoleEndedForTest(): void {
  endedTabs.clear()
}
