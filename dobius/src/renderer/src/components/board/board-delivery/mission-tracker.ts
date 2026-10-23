import { getConnectionId } from '@/lib/connection-context'
import { useAppStore } from '@/store'
import { latestOrder } from './board-orders'
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
const missions = new Map<string, Mission>()
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
}

export function trackMission(m: Mission): void {
  ensureWatching()
  missions.set(`${m.orderId}:${m.tabId}`, m)
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
