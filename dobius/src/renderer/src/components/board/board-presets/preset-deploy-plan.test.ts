import { describe, expect, it } from 'vitest'
import type { BoardState } from '@/store/slices/board'
import { capturePreset } from './board-preset'
import { presetCatalog } from './preset-catalog'
import {
  DEPLOY_CONFIRM_CONSOLES,
  buildCatalogDeployPlan,
  buildUserDeployPlan,
  cycleLaneAgent,
  fillLaneAgents,
  initialLaneAgents,
  needsDeployConfirm,
  uniformAgent,
  userPresetAgents,
  userPresetLanes
} from './preset-deploy-plan'

const ids = () => {
  let n = 0
  return () => `id-${++n}`
}
const deps = () => ({ newId: ids(), agentLabel: (a: string) => a.toUpperCase() })
const byId = (id: string) => presetCatalog().find((p) => p.id === id)!

describe('lane agents', () => {
  const deck = byId('command-deck')
  it('start from lane defaults, cycle one console, fill all', () => {
    const start = initialLaneAgents(deck.lanes)
    expect(uniformAgent(start)).toBe('claude')
    const cycled = cycleLaneAgent(start, 'review', 2)
    expect(cycled.review).toEqual(['claude', 'claude', 'codex', 'claude'])
    expect(uniformAgent(cycled)).toBeNull()
    expect(cycleLaneAgent(start, 'nope', 0)).toBe(start)
    expect(uniformAgent(fillLaneAgents(deck.lanes, 'shell'))).toBe('shell')
  })
})

describe('confirm threshold', () => {
  it('asks at 8 consoles or more', () => {
    expect(DEPLOY_CONFIRM_CONSOLES).toBe(8)
    expect(needsDeployConfirm(7)).toBe(false)
    expect(needsDeployConfirm(8)).toBe(true)
    expect(
      buildCatalogDeployPlan(
        byId('pairing-bay'),
        initialLaneAgents(byId('pairing-bay').lanes),
        { x: 0, y: 0 },
        deps()
      ).needsConfirm
    ).toBe(false)
    expect(
      buildCatalogDeployPlan(
        byId('release-train'),
        initialLaneAgents(byId('release-train').lanes),
        { x: 0, y: 0 },
        deps()
      ).needsConfirm
    ).toBe(true)
  })
})

describe('buildCatalogDeployPlan', () => {
  it('creates one group per lane, applies per-console agents, and wires the orchestrator to every console', () => {
    const deck = byId('command-deck')
    const agents = cycleLaneAgent(fillLaneAgents(deck.lanes, 'gemini'), 'ui', 0)
    const plan = buildCatalogDeployPlan(deck, agents, { x: 0, y: 0 }, deps())
    expect(plan.consoles).toHaveLength(12)
    expect(plan.consoles[0]).toMatchObject({ agent: 'opencode', title: 'Interface 1' })
    expect(plan.consoles.slice(1).every((c) => c.agent === 'gemini')).toBe(true)
    expect(plan.groups.map((g) => [g.name, g.cardIds.length])).toEqual([
      ['Interface', 4],
      ['Review', 4],
      ['Services', 4]
    ])
    const consoleIds = plan.consoles.map((c) => c.cardId)
    expect(plan.groups.flatMap((g) => g.cardIds)).toEqual(consoleIds)
    const kinds = plan.extras.map((e) => e.kind).sort()
    expect(kinds).toEqual(['kanban', 'orchestrator', 'web'])
    const orch = plan.extras.find((e) => e.kind === 'orchestrator')
    expect(orch?.kind === 'orchestrator' && orch.wiredCardIds).toEqual(consoleIds)
    const web = plan.extras.find((e) => e.kind === 'web')
    expect(web?.kind === 'web' && web.url).toBe('http://localhost:3000')
  })

  it('plain grids title consoles by agent and add no extras', () => {
    const plan = buildCatalogDeployPlan(
      byId('two-up'),
      initialLaneAgents(byId('two-up').lanes),
      { x: 0, y: 0 },
      deps()
    )
    expect(plan.consoles.map((c) => c.title)).toEqual(['CLAUDE 1', 'CLAUDE 2'])
    expect(plan.extras).toEqual([])
  })
})

describe('user presets', () => {
  const board = {
    cards: [
      {
        id: 'c1',
        kind: 'console',
        tabId: 't',
        agentKind: 'codex',
        x: 0,
        y: 0,
        w: 100,
        h: 100,
        z: 1,
        title: 'A'
      },
      {
        id: 'c2',
        kind: 'console',
        tabId: 't',
        agentKind: 'gemini',
        x: 200,
        y: 0,
        w: 100,
        h: 100,
        z: 2,
        title: 'B'
      },
      {
        id: 'c3',
        kind: 'console',
        tabId: 't',
        agentKind: 'weird',
        x: 400,
        y: 0,
        w: 100,
        h: 100,
        z: 3,
        title: 'C'
      },
      {
        id: 'o',
        kind: 'orchestrator',
        name: 'Lead',
        wiredCardIds: ['c1', 'c3'],
        x: 0,
        y: 200,
        w: 500,
        h: 100,
        z: 4,
        title: 'Lead'
      }
    ],
    groups: [{ id: 'g', name: 'Pair', color: 'blue', cardIds: ['c1', 'c2'] }],
    viewport: { x: 0, y: 0, zoom: 1 },
    tool: 'select'
  } as BoardState
  const preset = capturePreset(board, 'Mine', 'p', 0)

  it('derives lanes per group plus loose consoles, keeping saved agents', () => {
    const lanes = userPresetLanes(preset, 'Ungrouped')
    expect(lanes.map((l) => [l.name, l.count])).toEqual([
      ['Pair', 2],
      ['Ungrouped', 1]
    ])
    expect(userPresetAgents(preset, lanes)).toEqual({
      g: ['codex', 'gemini'],
      ungrouped: ['claude']
    })
  })

  it('re-centers the arrangement, re-ids everything and remaps wiring and groups', () => {
    const lanes = userPresetLanes(preset, 'Ungrouped')
    const plan = buildUserDeployPlan(
      preset,
      lanes,
      fillLaneAgents(lanes, 'shell'),
      { x: 1000, y: 1000 },
      { newId: ids() }
    )
    expect(plan.consoles.map((c) => c.agent)).toEqual(['shell', 'shell', 'shell'])
    expect(plan.consoles[0].rect).toEqual({ x: 750, y: 850, w: 100, h: 100 })
    const [c1, , c3] = plan.consoles.map((c) => c.cardId)
    expect(plan.groups[0].cardIds).toEqual([c1, plan.consoles[1].cardId])
    const orch = plan.extras[0]
    expect(orch.kind === 'orchestrator' && orch.wiredCardIds).toEqual([c1, c3])
    expect(new Set([...plan.consoles.map((c) => c.cardId), orch.id]).size).toBe(4)
  })
})
