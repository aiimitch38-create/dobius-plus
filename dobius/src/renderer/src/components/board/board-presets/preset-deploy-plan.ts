import type { BoardCard, BoardSwatch, NewBoardCard } from '@/store/slices/board'
import { isTuiAgent } from '../../../../../shared/tui-agent-config'
import { boardInsertCard } from '../board-route/board-insert-cards'
import type { BoardPreset } from './board-preset'
import {
  nextPresetAgent,
  type PresetAgent,
  type PresetDefinition,
  type PresetLane
} from './preset-catalog'
import { placePreset, type Rect } from './preset-placement'

// Pure: turns a preset + the studio's agent choices into exactly what Deploy
// will create. Side effects (spawning, placing) live in preset-deploy.ts.

/** Deploying this many consoles or more asks for confirmation first. */
export const DEPLOY_CONFIRM_CONSOLES = 8

/** Agent per console, per lane id. */
export type LaneAgents = Record<string, PresetAgent[]>

export type PlanConsole = { cardId: string; agent: PresetAgent; title: string; rect: Rect }
export type DeployPlan = {
  consoles: PlanConsole[]
  groups: { name: string; color: BoardSwatch; cardIds: string[] }[]
  /** Non-console cards with ids assigned; orchestrators are pre-wired to console card ids. */
  extras: (NewBoardCard & { id: string })[]
  needsConfirm: boolean
}

export function initialLaneAgents(lanes: readonly PresetLane[]): LaneAgents {
  return Object.fromEntries(
    lanes.map((l) => [l.id, Array.from({ length: l.count }, () => l.agent)])
  )
}

export function fillLaneAgents(lanes: readonly PresetLane[], agent: PresetAgent): LaneAgents {
  return Object.fromEntries(lanes.map((l) => [l.id, Array.from({ length: l.count }, () => agent)]))
}

export function cycleLaneAgent(agents: LaneAgents, laneId: string, slot: number): LaneAgents {
  const list = agents[laneId]
  if (!list || slot < 0 || slot >= list.length) {
    return agents
  }
  return { ...agents, [laneId]: list.map((a, i) => (i === slot ? nextPresetAgent(a) : a)) }
}

/** The single agent every console uses, or null when mixed. */
export function uniformAgent(agents: LaneAgents): PresetAgent | null {
  const all = Object.values(agents).flat()
  return all.length > 0 && all.every((a) => a === all[0]) ? all[0] : null
}

export function needsDeployConfirm(consoleCount: number): boolean {
  return consoleCount >= DEPLOY_CONFIRM_CONSOLES
}

type PlanDeps = { newId: () => string; agentLabel: (agent: PresetAgent) => string }

function agentAt(agents: LaneAgents, lane: PresetLane, slot: number): PresetAgent {
  return agents[lane.id]?.[slot] ?? lane.agent
}

export function buildCatalogDeployPlan(
  preset: PresetDefinition,
  agents: LaneAgents,
  center: { x: number; y: number },
  deps: PlanDeps
): DeployPlan {
  const placement = placePreset(preset, center)
  const consoles: PlanConsole[] = []
  const groups: DeployPlan['groups'] = []
  const perAgent = new Map<PresetAgent, number>()
  preset.lanes.forEach((lane, laneIndex) => {
    const cardIds = placement.consoles[laneIndex].map((rect, slot) => {
      const agent = agentAt(agents, lane, slot)
      const n = (perAgent.get(agent) ?? 0) + 1
      perAgent.set(agent, n)
      const cardId = deps.newId()
      consoles.push({
        cardId,
        agent,
        // Role crews read best by role; plain grids by agent.
        title:
          preset.section === 'workspace'
            ? `${lane.name} ${slot + 1}`
            : `${deps.agentLabel(agent)} ${n}`,
        rect
      })
      return cardId
    })
    groups.push({ name: lane.name, color: lane.color, cardIds })
  })
  const allConsoleIds = consoles.map((c) => c.cardId)
  const extras = placement.extras.map(({ kind, rect }) => {
    const id = deps.newId()
    const base = boardInsertCard(kind, { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 })
    const card = { ...base, ...rect, id } as NewBoardCard & { id: string }
    if (card.kind === 'orchestrator') {
      return { ...card, wiredCardIds: allConsoleIds }
    }
    const web = preset.extras.find((e) => e.kind === 'web')
    return card.kind === 'web' && web?.kind === 'web' ? { ...card, url: web.url } : card
  })
  return { consoles, groups, extras, needsConfirm: needsDeployConfirm(consoles.length) }
}

// ---- user presets ---------------------------------------------------------

const UNGROUPED_LANE = 'ungrouped'

/** Lanes for a saved board: one per group that holds consoles, plus loose consoles. */
export function userPresetLanes(preset: BoardPreset, ungroupedName: string): PresetLane[] {
  const consoles = preset.cards.filter(
    (c): c is Extract<BoardCard, { kind: 'console' }> => c.kind === 'console'
  )
  const byId = new Map(consoles.map((c) => [c.id, c]))
  const grouped = new Set<string>()
  const lanes: PresetLane[] = []
  for (const g of preset.groups) {
    const members = g.cardIds.filter((id) => byId.has(id))
    members.forEach((id) => grouped.add(id))
    if (members.length > 0) {
      const first = byId.get(members[0])!
      lanes.push({
        id: g.id,
        name: g.name,
        color: g.color,
        count: members.length,
        agent: asPresetAgent(first.agentKind)
      })
    }
  }
  const loose = consoles.filter((c) => !grouped.has(c.id))
  if (loose.length > 0) {
    lanes.push({
      id: UNGROUPED_LANE,
      name: ungroupedName,
      color: 'accent',
      count: loose.length,
      agent: asPresetAgent(loose[0].agentKind)
    })
  }
  return lanes
}

/** Per-console saved agents (not just the lane default), so a mixed group deploys as saved. */
export function userPresetAgents(preset: BoardPreset, lanes: readonly PresetLane[]): LaneAgents {
  const consoles = preset.cards.filter(
    (c): c is Extract<BoardCard, { kind: 'console' }> => c.kind === 'console'
  )
  const out: LaneAgents = {}
  for (const lane of lanes) {
    out[lane.id] = laneMembers(preset, lane.id, consoles).map((c) => asPresetAgent(c.agentKind))
  }
  return out
}

function laneMembers(
  preset: BoardPreset,
  laneId: string,
  consoles: Extract<BoardCard, { kind: 'console' }>[]
): Extract<BoardCard, { kind: 'console' }>[] {
  if (laneId !== UNGROUPED_LANE) {
    const ids = new Set(preset.groups.find((g) => g.id === laneId)?.cardIds ?? [])
    return consoles.filter((c) => ids.has(c.id))
  }
  const grouped = new Set(preset.groups.flatMap((g) => g.cardIds))
  return consoles.filter((c) => !grouped.has(c.id))
}

function asPresetAgent(kind: string): PresetAgent {
  return kind === 'shell' || isTuiAgent(kind) ? (kind as PresetAgent) : 'claude'
}

export function buildUserDeployPlan(
  preset: BoardPreset,
  lanes: readonly PresetLane[],
  agents: LaneAgents,
  center: { x: number; y: number },
  deps: Pick<PlanDeps, 'newId'>
): DeployPlan {
  const consolesAll = preset.cards.filter(
    (c): c is Extract<BoardCard, { kind: 'console' }> => c.kind === 'console'
  )
  // Re-center the saved arrangement on the requested point.
  const xs = preset.cards.flatMap((c) => [c.x, c.x + c.w])
  const ys = preset.cards.flatMap((c) => [c.y, c.y + c.h])
  const dx = preset.cards.length ? center.x - (Math.min(...xs) + Math.max(...xs)) / 2 : 0
  const dy = preset.cards.length ? center.y - (Math.min(...ys) + Math.max(...ys)) / 2 : 0
  const ids = new Map(preset.cards.map((c) => [c.id, deps.newId()]))
  const consoles: PlanConsole[] = []
  for (const lane of lanes) {
    laneMembers(preset, lane.id, consolesAll).forEach((card, slot) => {
      consoles.push({
        cardId: ids.get(card.id)!,
        agent: agents[lane.id]?.[slot] ?? lane.agent,
        title: card.title,
        rect: { x: card.x + dx, y: card.y + dy, w: card.w, h: card.h }
      })
    })
  }
  const remap = (list: readonly string[]): string[] =>
    list.flatMap((id) => (ids.has(id) ? [ids.get(id)!] : []))
  const extras = preset.cards
    .filter((c) => c.kind !== 'console')
    .map((card) => {
      const { z: _z, ...rest } = card
      const moved = {
        ...rest,
        id: ids.get(card.id)!,
        x: card.x + dx,
        y: card.y + dy
      } as NewBoardCard & { id: string }
      return moved.kind === 'orchestrator'
        ? { ...moved, wiredCardIds: remap(moved.wiredCardIds) }
        : moved
    })
  const groups = preset.groups.map((g) => ({
    name: g.name,
    color: g.color,
    cardIds: remap(g.cardIds)
  }))
  return { consoles, groups, extras, needsConfirm: needsDeployConfirm(consoles.length) }
}
