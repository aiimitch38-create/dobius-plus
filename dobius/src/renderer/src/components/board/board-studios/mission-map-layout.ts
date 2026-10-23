// Pure layout for the Mission Map studio: three columns (command center +
// orchestrators → groups → consoles) with edges from the board's wiring. No
// DOM, no store.
import type { BoardCard, BoardCardOf, BoardGroup, BoardSwatch } from '@/store/slices/board'

export type MissionMapNode =
  | {
      id: string
      /** The board's command bar: every console takes orders from it. */
      kind: 'command-center'
      label: string
      /** Every console card on the board. */
      cardIds: string[]
      /** Consoles no orchestrator is wired to (reachable only from the command bar). */
      unwiredCount: number
      x: number
      y: number
    }
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
  /**
   * `wire` = orchestrator → target, `member` = group → console, `command` =
   * command center → a console no orchestrator is wired to.
   */
  kind: 'wire' | 'member' | 'command'
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

export const COMMAND_CENTER_NODE_ID = 'command-center'
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
  groups: readonly BoardGroup[],
  commandCenterLabel = 'Command center'
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

  // Why: a wire to a grouped console lands on its group, so the map shows the
  // whole group as commanded; count its members as wired to match the picture.
  const directlyWired = new Set(
    orchestrators.flatMap((card) => card.wiredCardIds.filter((id) => consoleById.has(id)))
  )
  const wiredGroupIds = new Set(
    [...directlyWired].map((id) => groupOfConsole.get(id)).filter((id) => id !== undefined)
  )
  const wiredConsoleIds = new Set(
    consoles
      .filter((c) => directlyWired.has(c.id) || wiredGroupIds.has(groupOfConsole.get(c.id) ?? ''))
      .map((c) => c.id)
  )
  const unwired = consoles.filter((c) => !wiredConsoleIds.has(c.id))

  const nodes: MissionMapNode[] = []
  // Why: the command bar reaches every console, so it heads column 0 whenever
  // the board has one; orchestrators stack below it.
  const hasCommandCenter = consoles.length > 0
  if (hasCommandCenter) {
    nodes.push({
      id: COMMAND_CENTER_NODE_ID,
      kind: 'command-center',
      label: commandCenterLabel,
      cardIds: consoles.map((c) => c.id),
      unwiredCount: unwired.length,
      x: columnX(0),
      y: stackY(0)
    })
  }
  const orchestratorRowOffset = hasCommandCenter ? 1 : 0
  orchestrators.forEach((card, i) => {
    nodes.push({
      id: orchestratorNodeId(card.id),
      kind: 'orchestrator',
      cardId: card.id,
      label: card.name || card.title,
      x: columnX(0),
      y: stackY(i + orchestratorRowOffset)
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
  for (const card of unwired) {
    addEdge(COMMAND_CENTER_NODE_ID, consoleNodeId(card.id), 'command')
  }

  const rows = Math.max(
    orchestrators.length + orchestratorRowOffset,
    consoleGroups.length,
    consoles.length,
    1
  )
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

/** Board card ids a node stands for: its own card, a group's members, or every console. */
export function missionMapNodeCardIds(
  node: MissionMapNode,
  groups: readonly BoardGroup[]
): string[] {
  if (node.kind === 'command-center') {
    return node.cardIds
  }
  if (node.kind !== 'group') {
    return [node.cardId]
  }
  return groups.find((g) => g.id === node.groupId)?.cardIds ?? []
}

export type MissionMapCommander = {
  node: Extract<MissionMapNode, { kind: 'orchestrator' }>
  /** True when the wire lands on the console's group rather than the console. */
  viaGroup: boolean
}

/** Orchestrators that command a console, directly or through its group. */
export function missionMapCommandersOf(
  layout: Pick<MissionMapLayout, 'nodes' | 'edges'>,
  consoleId: string
): MissionMapCommander[] {
  const target = layout.nodes.find((n) => n.id === consoleId)
  if (!target || target.kind !== 'console') {
    return []
  }
  const groupId = target.groupId ? groupNodeId(target.groupId) : null
  const commanders: MissionMapCommander[] = []
  for (const edge of layout.edges) {
    if (edge.kind !== 'wire' || (edge.to !== consoleId && edge.to !== groupId)) {
      continue
    }
    const node = layout.nodes.find((n) => n.id === edge.from)
    if (node?.kind === 'orchestrator') {
      commanders.push({ node, viaGroup: edge.to === groupId })
    }
  }
  return commanders
}
