import { useSyncExternalStore } from 'react'

// Whether Hermes is tidying (compacting) ADAM's context inside his running turn.
// Main sends every change; the first subscriber also asks once, for a window
// that opened mid-compaction.

let compacting = false
let started = false
const listeners = new Set<() => void>()

function set(next: boolean): void {
  if (next !== compacting) {
    compacting = next
    for (const listener of listeners) {
      listener()
    }
  }
}

function start(): void {
  if (started) {
    return
  }
  const jarvis = typeof window === 'undefined' ? undefined : window.api?.jarvis
  if (!jarvis?.onAdamStatus) {
    return
  }
  started = true
  jarvis.onAdamStatus((status) => set(status.compacting))
  void jarvis
    .adamStatusGet?.()
    .then((status) => set(status.compacting))
    .catch(() => undefined)
}

function subscribe(listener: () => void): () => void {
  start()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Read at event time (the planner's send path). */
export function isAdamCompacting(): boolean {
  start()
  return compacting
}

export function useAdamCompacting(): boolean {
  return useSyncExternalStore(subscribe, () => compacting)
}

/** Tests only: drive the state without the preload bridge. */
export function setAdamCompactingForTest(next: boolean): void {
  set(next)
}
