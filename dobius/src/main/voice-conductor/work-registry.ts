// work-registry.ts — Phase 3 leaf module of the Voice Conductor port.
//
// In-memory backing store for the dobius-track / dobius-status / dobius-mark-done
// CLIs: the conductor tracks a dispatched job here, later queries its status or
// marks it done. Pure and deterministic — no Electron, IO, persistence, or
// notification side effects. The v1 reference (electron/work-registry.js) also
// persisted to config, watched tabs and fired iMessage final-reports; those
// belong to the CLI / dispatch layers. The concurrency cap lives here so every
// caller (dobius-track, dobius-spawn) reserves through one synchronous check.

import type { WorkItem, WorkRegistry, WorkTrackResult } from './types'

// The conductor prompt promises strictly serial work: one running item at a time.
export const MAX_RUNNING_WORK = 1

export function createWorkRegistry(options?: {
  initialItems?: readonly WorkItem[]
  onChange?: (items: readonly WorkItem[]) => void
  now?: () => number
}): WorkRegistry {
  const items = new Map<string, WorkItem>(
    options?.initialItems?.map((item) => [item.workId, { ...item }]) ?? []
  )
  const now = options?.now ?? Date.now

  function publish(from: Map<string, WorkItem>): void {
    options?.onChange?.(Array.from(from.values(), (item) => ({ ...item })))
  }

  function capacityError(exceptWorkId?: string): string | null {
    const running = Array.from(items.values()).filter(
      (item) => item.status === 'running' && item.workId !== exceptWorkId
    ).length
    return running >= MAX_RUNNING_WORK
      ? `concurrency cap: ${running}/${MAX_RUNNING_WORK} agents already running`
      : null
  }

  function track(
    item: Pick<WorkItem, 'workId' | 'tabId' | 'requestId' | 'description' | 'kind'>
  ): WorkTrackResult {
    const existing = items.get(item.workId)
    if (existing?.status === 'running' && existing.kind === 'spawn' && item.kind !== 'spawn') {
      return { ok: false, error: `work item "${item.workId}" belongs to a spawned agent run`, retryable: true }
    }
    // Re-tracking the running item itself updates it rather than adding a second one.
    const refusal = capacityError(item.workId)
    if (refusal) {
      return { ok: false, error: refusal, retryable: true }
    }
    const tracked: WorkItem = {
      workId: item.workId,
      tabId: item.tabId,
      requestId: item.requestId,
      description: item.description,
      startedAt: now(),
      status: 'running',
      ...(item.kind ? { kind: item.kind } : {})
    }
    // Persist first: a reservation that could not be saved is not made.
    publish(new Map(items).set(item.workId, tracked))
    items.set(item.workId, tracked)
    return { ok: true }
  }

  function status(target?: string): WorkItem[] {
    const all = Array.from(items.values())
    if (!target) {return all}
    const q = target.toLowerCase()
    return all.filter(
      (e) =>
        e.workId.toLowerCase().includes(q) ||
        e.tabId.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q),
    )
  }

  function markDone(
    workId: string,
    summary: string,
    status: 'done' | 'error' = 'done',
  ): WorkItem | null {
    const entry = items.get(workId)
    if (!entry) {return null}
    const updated: WorkItem = { ...entry, summary, status }
    // Release in memory even if the save then fails: the work did end, and a
    // stale 'running' row on disk is released at the next load for spawns.
    items.set(workId, updated)
    publish(items)
    return { ...updated }
  }

  function list(): WorkItem[] {
    return Array.from(items.values(), (item) => ({ ...item }))
  }

  return { track, capacityError: () => capacityError(), status, markDone, list }
}
