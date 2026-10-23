import { useCallback, useEffect, useState } from 'react'
import type { Automation } from '../../../../../shared/automations-types'

export const AUTOMATIONS_CHANGED_EVENT = 'dobius:automations-changed'
const REFRESH_MS = 5_000

export function isBoardLoopFor(automation: Automation, worktreeId: string): boolean {
  return automation.loop?.worktreeId === worktreeId
}

// Why: main mutates loop state (last fire, cursor, retirement) on its own tick,
// so the list re-reads on a short interval as well as on change events.
export function useBoardLoops(worktreeId: string | null): {
  loops: Automation[]
  refresh: () => void
} {
  const [loops, setLoops] = useState<Automation[]>([])
  const refresh = useCallback(() => {
    if (!worktreeId) {
      setLoops([])
      return
    }
    window.api.automations
      .list()
      .then((all) => setLoops(all.filter((a) => isBoardLoopFor(a, worktreeId))))
      .catch((error: unknown) => console.error('[board-loops] list failed', error))
  }, [worktreeId])
  useEffect(() => {
    refresh()
    const timer = window.setInterval(refresh, REFRESH_MS)
    window.addEventListener(AUTOMATIONS_CHANGED_EVENT, refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener(AUTOMATIONS_CHANGED_EVENT, refresh)
    }
  }, [refresh])
  return { loops, refresh }
}

export function notifyAutomationsChanged(): void {
  window.dispatchEvent(new Event(AUTOMATIONS_CHANGED_EVENT))
}
