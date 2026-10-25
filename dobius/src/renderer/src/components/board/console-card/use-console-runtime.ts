import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useAppStore } from '@/store'
import { isConsolePaused, onPauseChanged } from '../board-delivery/board-pause'
import {
  foregroundWithoutPty,
  isShellProcessName,
  type ConsoleForeground
} from './console-card-status'

export const FOREGROUND_POLL_MS = 10_000

export function useConsolePaused(tabId: string): boolean {
  const subscribe = useCallback((cb: () => void) => onPauseChanged(cb), [])
  return useSyncExternalStore(
    subscribe,
    () => isConsolePaused(tabId),
    () => false
  )
}

type ForegroundWatch = {
  value: ConsoleForeground
  listeners: Set<(value: ConsoleForeground) => void>
  timer: number
  check: () => void
}

// Why one watch per PTY: the card header, its glance, Mission Map and cables
// all ask for the same console's foreground; each used to run its own poll.
const foregroundWatches = new Map<string, ForegroundWatch>()
let visibilityHooked = false

function hookVisibility(): void {
  if (visibilityHooked || typeof document === 'undefined') {
    return
  }
  visibilityHooked = true
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      for (const watch of foregroundWatches.values()) {
        watch.check()
      }
    }
  })
}

/** Subscribes to a PTY's foreground kind; the first subscriber starts the poll, the last stops it. */
export function watchConsoleForeground(
  ptyId: string,
  listener: (value: ConsoleForeground) => void
): () => void {
  hookVisibility()
  let watch = foregroundWatches.get(ptyId)
  if (!watch) {
    const entry: ForegroundWatch = {
      value: null,
      listeners: new Set(),
      timer: 0,
      check: () => {
        if (document.visibilityState === 'hidden') {
          return
        }
        window.api.pty
          .getForegroundProcess(ptyId)
          .then((name) => {
            if (foregroundWatches.get(ptyId) !== entry) {
              return
            }
            const next: ConsoleForeground =
              name === null ? null : isShellProcessName(name) ? 'shell' : 'agent'
            if (next !== entry.value) {
              entry.value = next
              for (const notify of entry.listeners) {
                notify(next)
              }
            }
          })
          .catch((error: unknown) =>
            console.debug('[board-console] foreground check failed', error)
          )
      }
    }
    entry.timer = window.setInterval(entry.check, FOREGROUND_POLL_MS)
    foregroundWatches.set(ptyId, entry)
    entry.check()
    watch = entry
  }
  const current = watch
  current.listeners.add(listener)
  listener(current.value)
  return () => {
    current.listeners.delete(listener)
    if (current.listeners.size === 0 && foregroundWatches.get(ptyId) === current) {
      window.clearInterval(current.timer)
      foregroundWatches.delete(ptyId)
    }
  }
}

/**
 * What runs in the console's terminal: the agent or a bare shell. Why poll:
 * the agent feed goes quiet when an agent exits to its prompt, so only the
 * PTY's foreground process tells "idle" apart from "at its shell".
 */
// ponytail: 10s shared poll per PTY; an exit event from the PTY layer is the upgrade.
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
    return watchConsoleForeground(ptyId, setForeground)
  }, [ptyId, tabId])
  return foreground
}
