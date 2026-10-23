import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useAppStore } from '@/store'
import { isConsolePaused, onPauseChanged } from '../board-delivery/board-pause'
import {
  foregroundWithoutPty,
  isShellProcessName,
  type ConsoleForeground
} from './console-card-status'

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
  // ponytail: a card mounted after its PTY already exited shows idle, not done;
  // a persisted per-tab exit flag in the store is the upgrade.
  // Why keyed by tab: Restart swaps the card to a fresh tab that has no PTY yet.
  const tabWithPty = useRef<string | null>(null)
  useEffect(() => {
    if (!ptyId) {
      setForeground(foregroundWithoutPty(tabWithPty.current === tabId))
      return
    }
    tabWithPty.current = tabId
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
  }, [ptyId, tabId])
  return foreground
}
