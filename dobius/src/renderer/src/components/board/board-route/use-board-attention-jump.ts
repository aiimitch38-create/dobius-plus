import { useCallback } from 'react'
import { useAppStore } from '@/store'
import { getBoard, type BoardCardOf } from '@/store/slices/board'
import { AGENT_STATUS_STALE_AFTER_MS } from '../../../../../shared/agent-status-types'
import { focusBoardConsole, useBoardCameraFocus } from '../board-canvas/board-camera-focus'
import { boardStepId } from '../board-canvas/board-console-order'
import { boardAttentionTargets } from './board-attention-target'

/** Card ids of the consoles that need the user, longest-waiting first (the pill's rule). */
export function boardNeedsYouCardIds(worktreeId: string | null): string[] {
  const state = useAppStore.getState()
  const consoles = getBoard(state, worktreeId).cards.filter(
    (c): c is BoardCardOf<'console'> => c.kind === 'console'
  )
  return boardAttentionTargets(consoles, {
    agentStatusByPaneKey: state.agentStatusByPaneKey,
    acknowledgedAgentsByPaneKey: state.acknowledgedAgentsByPaneKey,
    now: Date.now(),
    staleAfterMs: AGENT_STATUS_STALE_AFTER_MS
  }).map((t) => t.cardId)
}

/**
 * The next console to visit for "N need you": the oldest waiting one first,
 * then each press moves on to the next, wrapping. Null when none needs you.
 */
export function nextNeedsYouCardId(
  waitingIds: readonly string[],
  focusedCardId: string | null
): string | null {
  return boardStepId(waitingIds, focusedCardId, 1)
}

/**
 * Returns a function that flies the camera (focus mode) to the next console
 * that needs the user. False, with the viewport untouched, when none does.
 */
export function useBoardAttentionJump(worktreeId: string | null): () => boolean {
  return useCallback((): boolean => {
    if (!worktreeId) {
      return false
    }
    const focus = useBoardCameraFocus.getState().focus
    const next = nextNeedsYouCardId(
      boardNeedsYouCardIds(worktreeId),
      focus?.worktreeId === worktreeId ? focus.cardId : null
    )
    return next ? focusBoardConsole(worktreeId, next) : false
  }, [worktreeId])
}
