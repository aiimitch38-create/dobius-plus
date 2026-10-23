// Pure filter logic for the Mission Map chips (All / Working / Needs you /
// Idle / Done). Statuses come from the same console status feed the card
// header uses; no DOM, no store.
import type { ConsoleCardStatus } from '../console-card/console-card-status'
import type { MissionMapEdge, MissionMapNode } from './mission-map-layout'

export type MissionMapFilter = 'all' | 'working' | 'waiting' | 'idle' | 'done'

export const MISSION_MAP_FILTERS: readonly MissionMapFilter[] = [
  'all',
  'working',
  'waiting',
  'idle',
  'done'
]

// Why: seven live states fold into four triage buckets. Paused is not doing
// work, so it sits with Idle; an agent back at its shell, an ended process
// and a closed tab are all "finished" from the triage view.
export function missionMapFilterOf(status: ConsoleCardStatus): Exclude<MissionMapFilter, 'all'> {
  switch (status) {
    case 'working':
      return 'working'
    case 'waiting':
      return 'waiting'
    case 'idle':
    case 'paused':
      return 'idle'
    case 'shell':
    case 'done':
    case 'gone':
      return 'done'
  }
}

export function missionMapFilterCounts(
  statuses: Readonly<Record<string, ConsoleCardStatus>>
): Record<MissionMapFilter, number> {
  const counts: Record<MissionMapFilter, number> = {
    all: 0,
    working: 0,
    waiting: 0,
    idle: 0,
    done: 0
  }
  for (const status of Object.values(statuses)) {
    counts.all += 1
    counts[missionMapFilterOf(status)] += 1
  }
  return counts
}

/**
 * Node ids that stay lit under a filter: matching consoles, groups holding a
 * match, and orchestrators wired to a lit console or group. `statuses` is keyed
 * by console node id; a console with no status yet counts as idle.
 */
export function missionMapVisibleNodeIds(
  nodes: readonly MissionMapNode[],
  edges: readonly MissionMapEdge[],
  statuses: Readonly<Record<string, ConsoleCardStatus>>,
  filter: MissionMapFilter
): Set<string> {
  if (filter === 'all') {
    return new Set(nodes.map((n) => n.id))
  }
  const visible = new Set<string>()
  for (const node of nodes) {
    if (node.kind === 'console' && missionMapFilterOf(statuses[node.id] ?? 'idle') === filter) {
      visible.add(node.id)
    }
  }
  for (const edge of edges) {
    if (edge.kind === 'member' && visible.has(edge.to)) {
      visible.add(edge.from)
    }
  }
  for (const edge of edges) {
    if (edge.kind === 'wire' && visible.has(edge.to)) {
      visible.add(edge.from)
    }
  }
  return visible
}

/** Pause makes sense only while an agent holds the terminal (Resume is for `paused`). */
export function missionMapCanPause(status: ConsoleCardStatus): boolean {
  return status === 'working' || status === 'waiting' || status === 'idle'
}
