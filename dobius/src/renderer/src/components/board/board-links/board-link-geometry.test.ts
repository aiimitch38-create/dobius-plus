import { describe, expect, it } from 'vitest'
import type { BoardCard, BoardGroup } from '@/store/slices/board'
import {
  connectorArrows,
  linkEndpoints,
  linkPath,
  orchestratorCables,
  rectExitPoint,
  toggleWired
} from './board-link-geometry'

const base = { y: 0, w: 100, h: 100, z: 1, title: '' }
const consoleCard = (id: string, x: number): BoardCard => ({
  ...base,
  id,
  x,
  kind: 'console',
  tabId: `t-${id}`,
  agentKind: 'claude'
})
const orch = (wired: string[]): BoardCard => ({
  ...base,
  id: 'o',
  x: -400,
  kind: 'orchestrator',
  name: 'O',
  wiredCardIds: wired
})
const group = (cardIds: string[]): BoardGroup => ({ id: 'g', name: 'G', color: 'blue', cardIds })

describe('rectExitPoint / linkEndpoints', () => {
  it('leaves the border facing the other rect', () => {
    expect(rectExitPoint({ x: 0, y: 0, w: 100, h: 50 }, { x: 500, y: 25 })).toEqual({
      x: 100,
      y: 25
    })
    expect(rectExitPoint({ x: 0, y: 0, w: 100, h: 50 }, { x: 50, y: -300 })).toEqual({
      x: 50,
      y: 0
    })
    const { start, end } = linkEndpoints(
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 100, y: 0, w: 10, h: 10 }
    )
    expect(start).toEqual({ x: 10, y: 5 })
    expect(end).toEqual({ x: 100, y: 5 })
    expect(linkPath(start, end)).toMatch(/^M 10 5 C /)
  })
})

describe('orchestratorCables', () => {
  it('draws one cable to a fully wired group and single cables otherwise', () => {
    const cards = [
      orch(['a', 'b', 'c']),
      consoleCard('a', 0),
      consoleCard('b', 200),
      consoleCard('c', 400)
    ]
    const cables = orchestratorCables({ cards, groups: [group(['a', 'b'])] })
    expect(cables.map((c) => c.id).sort()).toEqual(['o->c', 'o->group:g'])
  })

  it('falls back to member cables when the group is only partly wired, and skips non-consoles', () => {
    const cards = [orch(['a', 'missing']), consoleCard('a', 0), consoleCard('b', 200)]
    expect(orchestratorCables({ cards, groups: [group(['a', 'b'])] }).map((c) => c.id)).toEqual([
      'o->a'
    ])
  })
})

describe('connectorArrows', () => {
  it('skips connectors whose cards are gone', () => {
    const cards = [consoleCard('a', 0), consoleCard('b', 200)]
    const arrows = connectorArrows({
      cards,
      connectors: [
        { id: 'k1', fromCardId: 'a', toCardId: 'b' },
        { id: 'k2', fromCardId: 'a', toCardId: 'x' }
      ]
    })
    expect(arrows.map((a) => a.id)).toEqual(['k1'])
  })
})

describe('toggleWired', () => {
  it('adds missing targets, and removes them when all are already wired', () => {
    expect(toggleWired(['a'], ['a', 'b'])).toEqual(['a', 'b'])
    expect(toggleWired(['a', 'b', 'c'], ['a', 'b'])).toEqual(['c'])
    expect(toggleWired(['a'], [])).toEqual(['a'])
  })
})
