import { useSyncExternalStore } from 'react'
import type {
  UsageProbeProgress,
  UsageProbeStage
} from '../../../../../../shared/rate-limit-types'
import type { UsageProviderId } from './board-usage-model'

// Live fetch stage per provider, fed by main's `rateLimits:progress` events.
// Why a tiny external store and not the app store: these are transient hints
// for one popover, and the IPC subscription should only exist while it listens.

type ProgressEntry = { stage: UsageProbeStage; at: number }

let entries: Partial<Record<UsageProviderId, ProgressEntry>> = {}
const listeners = new Set<() => void>()
let unsubscribeIpc: (() => void) | null = null

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function applyUsageProbeProgress(progress: UsageProbeProgress): void {
  entries = { ...entries, [progress.provider]: { stage: progress.stage, at: progress.at } }
  emit()
}

/** Called when a provider's fetch settles so the next fetch starts from a clean stage. */
export function clearUsageProbeProgress(provider: UsageProviderId): void {
  if (!entries[provider]) {
    return
  }
  const next = { ...entries }
  delete next[provider]
  entries = next
  emit()
}

export function resetUsageProbeProgressForTest(): void {
  entries = {}
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (!unsubscribeIpc && typeof window !== 'undefined' && window.api?.rateLimits?.onProgress) {
    unsubscribeIpc = window.api.rateLimits.onProgress(applyUsageProbeProgress)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && unsubscribeIpc) {
      unsubscribeIpc()
      unsubscribeIpc = null
    }
  }
}

export function useUsageProbeStage(provider: UsageProviderId): UsageProbeStage | null {
  return useSyncExternalStore(
    subscribe,
    () => entries[provider]?.stage ?? null,
    () => null
  )
}
