// Pure layout for the Mission Map studio: three columns (orchestrators → groups
// → consoles) with edges from the board's wiring. No DOM, no store.
import type { BoardCard, BoardCardOf, BoardGroup, BoardSwatch } from '@/store/slices/board'

export type MissionMapNode =
  | {
      id: string
      kind: 'orchestrator'
      cardId: string
      label: string
      x: number
      y: number
    }
  | {
      id: string
      kind: 'group'
      groupId: string
      label: string
      color: BoardSwatch
      x: number
      y: number
    }
  | {
      id: string
      kind: 'console'
      cardId: string
      tabId: string
      agentKind: string
      groupId: string | null
      label: string
      x: number
      y: number
    }

export type MissionMapEdge = {
  id: string
  from: string
  to: string
  /** `wire` = orchestrator → target, `member` = group → console. */
  kind: 'wire' | 'member'
}

export type MissionMapLayout = {
  nodes: MissionMapNode[]
  edges: MissionMapEdge[]
  width: number
  height: number
  /** Top y of the ungrouped console bucket, or null when every console is grouped. */
  ungroupedBucketY: number | null
}

export const MISSION_MAP_NODE_W = 184
export const MISSION_MAP_NODE_H = 44
const COLUMN_GAP = 128
const ROW_GAP = 14
const BUCKET_GAP = 36
const PADDING = 28

export const orchestratorNodeId = (cardId: string): string => `orchestrator:${cardId}`
export const groupNodeId = (groupId: string): string => `group:${groupId}`
export const consoleNodeId = (cardId: string): string => `console:${cardId}`

type ConsoleCard = BoardCardOf<'console'>
type OrchestratorCard = BoardCardOf<'orchestrator'>

function columnX(column: number): number {
  return PADDING + column * (MISSION_MAP_NODE_W + COLUMN_GAP)
}

function stackY(index: number, extraGap = 0): number {
  return PADDING + index * (MISSION_MAP_NODE_H + ROW_GAP) + extraGap
}

export function layoutMissionMap(
  cards: readonly BoardCard[],
  groups: readonly BoardGroup[]
): MissionMapLayout {
  const consoles = cards.filter((c): c is ConsoleCard => c.kind === 'console')
  const orchestrators = cards.filter((c): c is OrchestratorCard => c.kind === 'orchestrator')
  const consoleById = new Map(consoles.map((c) => [c.id, c]))

  // Why: a card lives in at most one group; keep the first membership if the
  // persisted data ever disagrees so the map never draws a console twice.
  const groupOfConsole = new Map<string, string>()
  const consoleGroups: { group: BoardGroup; members: string[] }[] = []
  for (const group of groups) {
    const members = group.cardIds.filter((id) => consoleById.has(id) && !groupOfConsole.has(id))
    if (members.length === 0) {
      continue
    }
    for (const id of members) {
      groupOfConsole.set(id, group.id)
    }
    consoleGroups.push({ group, members })
  }
  const ungrouped = consoles.filter((c) => !groupOfConsole.has(c.id))

  const nodes: MissionMapNode[] = []
  orchestrators.forEach((card, i) => {
    nodes.push({
      id: orchestratorNodeId(card.id),
      kind: 'orchestrator',
      cardId: card.id,
      label: card.name || card.title,
      x: columnX(0),
      y: stackY(i)
    })
  })
  consoleGroups.forEach(({ group }, i) => {
    nodes.push({
      id: groupNodeId(group.id),
      kind: 'group',
      groupId: group.id,
      label: group.name,
      color: group.color,
      x: columnX(1),
      y: stackY(i)
    })
  })

  let row = 0
  const pushConsole = (card: ConsoleCard, extraGap: number): void => {
    nodes.push({
      id: consoleNodeId(card.id),
      kind: 'console',
      cardId: card.id,
      tabId: card.tabId,
      agentKind: card.agentKind,
      groupId: groupOfConsole.get(card.id) ?? null,
      label: card.title,
      x: columnX(2),
      y: stackY(row, extraGap)
    })
    row += 1
  }
  for (const { members } of consoleGroups) {
    for (const id of members) {
      pushConsole(consoleById.get(id)!, 0)
    }
  }
  const bucketGap = consoleGroups.length > 0 && ungrouped.length > 0 ? BUCKET_GAP : 0
  const ungroupedBucketY = ungrouped.length > 0 ? stackY(row, bucketGap) : null
  for (const card of ungrouped) {
    pushConsole(card, bucketGap)
  }

  const edges: MissionMapEdge[] = []
  const seen = new Set<string>()
  const addEdge = (from: string, to: string, kind: MissionMapEdge['kind']): void => {
    const id = `${from}->${to}`
    if (!seen.has(id)) {
      seen.add(id)
      edges.push({ id, from, to, kind })
    }
  }
  for (const card of orchestrators) {
    for (const targetId of card.wiredCardIds) {
      if (!consoleById.has(targetId)) {
        continue
      }
      const groupId = groupOfConsole.get(targetId)
      addEdge(
        orchestratorNodeId(card.id),
        groupId ? groupNodeId(groupId) : consoleNodeId(targetId),
        'wire'
      )
    }
  }
  for (const { group, members } of consoleGroups) {
    for (const id of members) {
      addEdge(groupNodeId(group.id), consoleNodeId(id), 'member')
    }
  }

  const rows = Math.max(orchestrators.length, consoleGroups.length, consoles.length, 1)
  return {
    nodes,
    edges,
    width: columnX(2) + MISSION_MAP_NODE_W + PADDING,
    height: stackY(rows - 1, bucketGap) + MISSION_MAP_NODE_H + PADDING,
    ungroupedBucketY
  }
}

/** Cubic path from a node's right edge to another node's left edge. */
export function missionMapEdgePath(
  from: Pick<MissionMapNode, 'x' | 'y'>,
  to: Pick<MissionMapNode, 'x' | 'y'>
): string {
  const x1 = from.x + MISSION_MAP_NODE_W
  const y1 = from.y + MISSION_MAP_NODE_H / 2
  const x2 = to.x
  const y2 = to.y + MISSION_MAP_NODE_H / 2
  const bend = Math.max(24, (x2 - x1) / 2)
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`
}

/** Board card ids a node stands for: its own card, or a group's members. */
export function missionMapNodeCardIds(
  node: MissionMapNode,
  groups: readonly BoardGroup[]
): string[] {
  if (node.kind !== 'group') {
    return [node.cardId]
  }
  return groups.find((g) => g.id === node.groupId)?.cardIds ?? []
}
