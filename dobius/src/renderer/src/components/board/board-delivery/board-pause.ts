// Which board consoles are paused. Pausing suspends the agent process (see
// item 5 in pause-consoles.ts); this registry is what the delivery gate and the
// status light read.

const paused = new Set<string>()
const listeners = new Set<() => void>()

export function isConsolePaused(tabId: string): boolean {
  return paused.has(tabId)
}

export function markConsolePaused(tabId: string, isPaused: boolean): void {
  if (isPaused === paused.has(tabId)) {
    return
  }
  if (isPaused) {
    paused.add(tabId)
  } else {
    paused.delete(tabId)
  }
  for (const l of listeners) {
    l()
  }
}

export function pausedConsoleIds(): ReadonlySet<string> {
  return paused
}

export function onPauseChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function resetBoardPauseForTest(): void {
  paused.clear()
  listeners.clear()
}
