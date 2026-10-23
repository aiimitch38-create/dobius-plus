import { useCallback } from 'react'
import { useAppStore } from '@/store'
import { getBoard, type BoardCardOf } from '@/store/slices/board'
import { AGENT_STATUS_STALE_AFTER_MS } from '../../../../../shared/agent-status-types'
import { boardAttentionTarget } from './board-attention-target'

/**
 * Returns a function that centers the viewport on the console that needs the
 * user (same rule as the needs-you badge), zooming in if the user was more
 * zoomed out than 80%. Returns false (and leaves the viewport untouched) when
 * no console currently needs attention.
 */
export function useBoardAttentionJump(worktreeId: string | null): () => boolean {
  return useCallback((): boolean => {
    const state = useAppStore.getState()
    const board = getBoard(state, worktreeId)
    const consoles = board.cards.filter((c): c is BoardCardOf<'console'> => c.kind === 'console')

    const target = boardAttentionTarget(consoles, {
      agentStatusByPaneKey: state.agentStatusByPaneKey,
      acknowledgedAgentsByPaneKey: state.acknowledgedAgentsByPaneKey,
      now: Date.now(),
      staleAfterMs: AGENT_STATUS_STALE_AFTER_MS
    })
    if (!target || !worktreeId) {
      return false
    }

    const zoom = Math.max(board.viewport.zoom, 0.8)
    // Why: screen = world * zoom + offset (board-viewport.ts), so centering
    // `target.center` on the screen midpoint solves for the offset directly.
    const screenCenterX = window.innerWidth / 2
    const screenCenterY = window.innerHeight / 2
    state.setViewport(worktreeId, {
      zoom,
      x: screenCenterX - target.center.x * zoom,
      y: screenCenterY - target.center.y * zoom
    })
    return true
  }, [worktreeId])
}
