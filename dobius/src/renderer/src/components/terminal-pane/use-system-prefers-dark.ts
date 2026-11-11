import { useSyncExternalStore } from 'react'
import { isDaytime } from '@/lib/document-theme'

// Why: "System" resolves off local time of day (day = light, night = dark),
// not the OS's prefers-color-scheme signal — see lib/document-theme.ts.
// Terminal panes can number in the hundreds, so share a single timer instead
// of one per pane.
const REEVALUATE_INTERVAL_MS = 60_000

const subscribers = new Set<() => void>()
let intervalHandle: ReturnType<typeof setInterval> | null = null
let hasSnapshot = false
let snapshot = true

function computeSnapshot(): boolean {
  return !isDaytime()
}

function refreshSnapshot(): void {
  snapshot = computeSnapshot()
  hasSnapshot = true
}

export function getSystemPrefersDarkSnapshot(): boolean {
  if (!hasSnapshot) {
    refreshSnapshot()
  }
  return snapshot
}

export function subscribeToSystemPrefersDarkChange(onChange: () => void): () => void {
  subscribers.add(onChange)
  if (!intervalHandle) {
    refreshSnapshot()
    intervalHandle = setInterval(() => {
      const next = computeSnapshot()
      if (next !== snapshot) {
        snapshot = next
        for (const subscriber of subscribers) {
          subscriber()
        }
      }
    }, REEVALUATE_INTERVAL_MS)
  }
  return () => {
    subscribers.delete(onChange)
    if (subscribers.size > 0) {
      return
    }
    if (intervalHandle) {
      clearInterval(intervalHandle)
      intervalHandle = null
    }
    hasSnapshot = false
  }
}

export function useSystemPrefersDark(): boolean {
  return useSyncExternalStore(
    subscribeToSystemPrefersDarkChange,
    getSystemPrefersDarkSnapshot,
    () => true
  )
}

export function resetSystemPrefersDarkSubscriptionForTests(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle)
  }
  subscribers.clear()
  intervalHandle = null
  hasSnapshot = false
  snapshot = true
}
