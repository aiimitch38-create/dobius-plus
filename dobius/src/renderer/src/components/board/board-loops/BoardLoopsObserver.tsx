import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import { getBoard } from '@/store/slices/board'
import { AGENT_STATUS_STALE_AFTER_MS } from '../../../../../shared/agent-status-types'
import {
  INITIAL_IDLE_WATCH,
  idleWatchDue,
  stepIdleWatch,
  type IdleWatch
} from '../../../../../shared/automation-loops'
import { useBoardLoops } from './board-loop-list'
import { loopTargetTabIds, targetIsWorking } from './loop-form'

const SAMPLE_MS = 1_000

/**
 * Mount once while the Board is visible. Watches on-idle loops' targets and
 * asks main to fire through the normal runNow path; main re-checks admission
 * (pause, retirement, debounce gap) before relaying anything.
 */
// ponytail: 1s sampling instead of a store subscription; status changes are
// already coarse and the debounce is >= 1s.
export function BoardLoopsObserver({ worktreeId }: { worktreeId: string }): null {
  const { loops } = useBoardLoops(worktreeId)
  const watches = useRef(new Map<string, IdleWatch>())

  useEffect(() => {
    const idleLoops = loops.filter((l) => l.enabled && l.loop?.trigger.kind === 'on-idle')
    const timer = window.setInterval(() => {
      const now = Date.now()
      const state = useAppStore.getState()
      const board = getBoard(state, worktreeId)
      for (const automation of idleLoops) {
        const trigger = automation.loop?.trigger
        if (trigger?.kind !== 'on-idle') {
          continue
        }
        const working = targetIsWorking(
          state.agentStatusByPaneKey,
          loopTargetTabIds(trigger.target, board),
          now,
          AGENT_STATUS_STALE_AFTER_MS
        )
        const next = stepIdleWatch(
          watches.current.get(automation.id) ?? INITIAL_IDLE_WATCH,
          working,
          now
        )
        if (idleWatchDue(next, now, trigger.debounceMs)) {
          watches.current.set(automation.id, INITIAL_IDLE_WATCH)
          // Rejections are expected (paused, deduped by another window); main records real fires.
          window.api.automations
            .runNow({ id: automation.id })
            .catch((error: unknown) => console.debug('[board-loops] fire not admitted', error))
        } else {
          watches.current.set(automation.id, next)
        }
      }
    }, SAMPLE_MS)
    return () => window.clearInterval(timer)
  }, [loops, worktreeId])

  return null
}
