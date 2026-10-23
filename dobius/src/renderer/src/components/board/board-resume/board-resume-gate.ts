import { useAppStore } from '@/store'
import { getBoard } from '@/store/slices/board'
import { parsePaneKey } from '../../../../../shared/stable-pane-id'
import {
  boardResumeModeOf,
  boardResumeRegistry,
  type DeferredBoardResume,
  type LivePaneSession
} from './board-resume-registry'

type AppState = ReturnType<typeof useAppStore.getState>

/**
 * Called by the PTY cold-restore path before it resumes an agent session.
 * True means "start this pane fresh and let the board toast ask". Always false
 * under the default "Resume automatically" setting, so restores are unchanged.
 */
export function shouldDeferBoardConsoleResume(entry: DeferredBoardResume): boolean {
  const state = useAppStore.getState()
  const ask = boardResumeModeOf(state.settings) === 'ask'
  if (!ask && !boardResumeRegistry.knows(entry.tabId)) {
    return false
  }
  const isBoardConsole = getBoard(state, entry.worktreeId).cards.some(
    (card) => card.kind === 'console' && card.tabId === entry.tabId
  )
  return boardResumeRegistry.decide(entry, { ask, isBoardConsole })
}

export function boardConsoleTabIds(state: AppState, worktreeId: string): Set<string> {
  const ids = new Set<string>()
  for (const card of getBoard(state, worktreeId).cards) {
    if (card.kind === 'console') {
      ids.add(card.tabId)
    }
  }
  return ids
}

export function livePaneSessions(state: AppState): LivePaneSession[] {
  return Object.entries(state.agentStatusByPaneKey).map(([paneKey, entry]) => ({
    tabId: parsePaneKey(paneKey)?.tabId,
    state: entry.state,
    providerSession: entry.providerSession ?? null
  }))
}
