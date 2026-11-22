import { getConnectionId } from '@/lib/connection-context'
import { useAppStore } from '@/store'
import { isOrderRetained, latestOrder, onOrdersChanged } from './board-orders'
import {
  advanceMission,
  latestEntryForTab,
  orderSettled,
  outputFileName,
  type Mission
} from './mission-state'

// Live mission tracking over the agent-status feed. Emits one event per agent
// reply (a report row in the thread), a timeout note, and "N finished" once an
// order settles. ponytail: in memory per window, like the orders registry.

export type MissionEvent =
  | { kind: 'reply'; mission: Mission }
  | { kind: 'timeout'; mission: Mission }
  | { kind: 'settled'; orderId: string; finished: number }

const TIMEOUT_SWEEP_MS = 30_000
// Missions (each holding the agent's full last reply) live as long as their
// order is in the orders registry (board-orders.ts keeps the last 50), or while
// a forward/handoff wait pins them.
const missions = new Map<string, Mission>()
const pinnedOrders = new Map<string, number>()
const listeners = new Set<(event: MissionEvent) => void>()
const settledOrders = new Set<string>()
let watching = false

function emit(event: MissionEvent): void {
  for (const l of listeners) {
    l(event)
  }
}

function sweep(): void {
  const byPaneKey = useAppStore.getState().agentStatusByPaneKey
  const now = Date.now()
  const touchedOrders = new Set<string>()
  for (const [key, m] of missions) {
    const next = advanceMission(m, latestEntryForTab(byPaneKey, m.tabId), now)
    if (next === m) {
      continue
    }
    missions.set(key, next)
    if (next.state === 'finished' && m.state !== 'finished') {
      emit({ kind: 'reply', mission: next })
      touchedOrders.add(next.orderId)
    } else if (next.state === 'timeout' && m.state === 'running') {
      emit({ kind: 'timeout', mission: next })
      touchedOrders.add(next.orderId)
    }
  }
  for (const orderId of touchedOrders) {
    const lanes = [...missions.values()].filter((m) => m.orderId === orderId)
    if (!settledOrders.has(orderId) && orderSettled(lanes)) {
      settledOrders.add(orderId)
      emit({
        kind: 'settled',
        orderId,
        finished: lanes.filter((m) => m.state === 'finished').length
      })
    }
  }
}

function ensureWatching(): void {
  if (watching) {
    return
  }
  watching = true
  useAppStore.subscribe((s, prev) => {
    if (s.agentStatusByPaneKey !== prev.agentStatusByPaneKey && missions.size > 0) {
      sweep()
    }
  })
  setInterval(() => missions.size > 0 && sweep(), TIMEOUT_SWEEP_MS)
  onOrdersChanged(pruneEvictedOrders)
}

function isOrderKept(orderId: string): boolean {
  return pinnedOrders.has(orderId) || isOrderRetained(orderId)
}

function pruneEvictedOrders(): void {
  for (const [key, m] of missions) {
    if (!isOrderKept(m.orderId)) {
      missions.delete(key)
    }
  }
  for (const orderId of settledOrders) {
    if (!isOrderKept(orderId)) {
      settledOrders.delete(orderId)
    }
  }
}

export function trackMission(m: Mission): void {
  ensureWatching()
  // Why: a lane that finishes delivering after its order left the registry has
  // nothing left to show it; keeping it would leak.
  if (!isOrderKept(m.orderId)) {
    return
  }
  missions.set(`${m.orderId}:${m.tabId}`, m)
}

/**
 * Keeps an order's missions past registry eviction while something waits on
 * them (forward/handoff). Returns the release; released orders not in the
 * registry are dropped.
 */
export function pinOrderMissions(orderId: string): () => void {
  pinnedOrders.set(orderId, (pinnedOrders.get(orderId) ?? 0) + 1)
  let released = false
  return () => {
    if (released) {
      return
    }
    released = true
    const left = (pinnedOrders.get(orderId) ?? 1) - 1
    if (left > 0) {
      pinnedOrders.set(orderId, left)
    } else {
      pinnedOrders.delete(orderId)
      pruneEvictedOrders()
    }
  }
}

export function trackedMissionCountForTest(): { missions: number; settledOrders: number } {
  return { missions: missions.size, settledOrders: settledOrders.size }
}

/** Missions (one per lane that received it) of one order, current state. */
export function missionsForOrder(orderId: string): Mission[] {
  return [...missions.values()].filter((m) => m.orderId === orderId)
}

export function onMissionEvent(listener: (event: MissionEvent) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Writes a reply to `<worktree>/outputs/<timestamp>-<console>.md`; returns the path. */
export async function saveMissionOutput(m: Mission): Promise<string> {
  const worktree = useAppStore.getState().getKnownWorktreeById?.(m.worktreeId)
  if (!worktree?.path) {
    throw new Error('workspace folder not found')
  }
  const sep = worktree.path.includes('\\') && !worktree.path.includes('/') ? '\\' : '/'
  const filePath = [
    worktree.path.replace(/[\\/]+$/, ''),
    'outputs',
    outputFileName(m.name, m.finishedAt ?? Date.now())
  ].join(sep)
  const order = latestOrder(m.worktreeId)
  const content = `# ${m.name}\n\n${order?.id === m.orderId ? `> ${order.text}\n\n` : ''}${m.reply ?? ''}\n`
  await window.api.fs.writeFile({
    filePath,
    content,
    connectionId: getConnectionId(m.worktreeId) ?? undefined
  })
  return filePath
}
