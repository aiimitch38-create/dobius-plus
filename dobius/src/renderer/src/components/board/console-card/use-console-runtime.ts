import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useAppStore } from '@/store'
import { isConsolePaused, onPauseChanged } from '../board-delivery/board-pause'
import { isShellProcessName, type ConsoleForeground } from './console-card-status'

const FOREGROUND_POLL_MS = 4_000

export function useConsolePaused(tabId: string): boolean {
  const subscribe = useCallback((cb: () => void) => onPauseChanged(cb), [])
  return useSyncExternalStore(
    subscribe,
    () => isConsolePaused(tabId),
    () => false
  )
}

/**
 * What runs in the console's terminal: the agent or a bare shell. Why poll:
 * the agent feed goes quiet when an agent exits to its prompt, so only the
 * PTY's foreground process tells "idle" apart from "at its shell".
 */
// ponytail: 4s poll per console card; an exit event from the PTY layer is the upgrade.
export function useConsoleForeground(tabId: string): ConsoleForeground {
  const ptyId = useAppStore((s) => s.ptyIdsByTabId[tabId]?.[0] ?? null)
  const [foreground, setForeground] = useState<ConsoleForeground>(null)
  useEffect(() => {
    if (!ptyId) {
      setForeground(null)
      return
    }
    let cancelled = false
    const check = (): void => {
      window.api.pty
        .getForegroundProcess(ptyId)
        .then((name) => {
          if (!cancelled) {
            setForeground(name === null ? null : isShellProcessName(name) ? 'shell' : 'agent')
          }
        })
        .catch((error: unknown) => console.debug('[board-console] foreground check failed', error))
    }
    check()
    const timer = window.setInterval(check, FOREGROUND_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [ptyId])
  return foreground
}
