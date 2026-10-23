import { describe, expect, it } from 'vitest'
import type { BoardState } from '@/store/slices/board'
import { capturePreset, planPresetApply, sanitizePresetsByRepo } from './board-preset'

const board = {
  cards: [
    {
      id: 'c1',
      kind: 'console',
      tabId: 'live-tab',
      agentKind: 'codex',
      x: 0,
      y: 0,
      w: 400,
      h: 300,
      z: 1,
      title: 'Codex'
    },
    {
      id: 'n1',
      kind: 'note',
      text: 'plan',
      color: 'yellow',
      x: 500,
      y: 0,
      w: 200,
      h: 150,
      z: 2,
      title: 'Note'
    },
    {
      id: 'o1',
      kind: 'orchestrator',
      name: 'Lead',
      wiredCardIds: ['c1', 'gone'],
      x: 0,
      y: 400,
      w: 300,
      h: 300,
      z: 3,
      title: 'Lead'
    }
  ],
  groups: [{ id: 'g1', name: 'Team A', color: 'blue', cardIds: ['c1', 'n1'] }],
  viewport: { x: 0, y: 0, zoom: 1 },
  tool: 'select'
} as BoardState

describe('capturePreset', () => {
  it('drops live terminal ids but keeps agent kinds and layout', () => {
    const preset = capturePreset(board, ' Review squad ', 'p1', 10)
    expect(preset.name).toBe('Review squad')
    expect(preset.cards[0]).toMatchObject({
      kind: 'console',
      tabId: '',
      agentKind: 'codex',
      x: 0,
      w: 400
    })
    expect(preset.cards[1]).toEqual(board.cards[1])
  })
})

describe('planPresetApply', () => {
  it('re-ids cards and remaps groups and orchestrator wiring', () => {
    let n = 0
    const plan = planPresetApply(capturePreset(board, 'x', 'p', 0), () => `new-${++n}`)
    expect(plan.cards.map((c) => c.id)).toEqual(['new-1', 'new-2', 'new-3'])
    expect(plan.cards[2]).toMatchObject({ kind: 'orchestrator', wiredCardIds: ['new-1'] })
    expect(plan.groups).toEqual([{ name: 'Team A', color: 'blue', cardIds: ['new-1', 'new-2'] }])
    expect('z' in plan.cards[0]).toBe(false)
  })
})

describe('sanitizePresetsByRepo', () => {
  it('keeps valid presets and drops malformed ones', () => {
    const preset = capturePreset(board, 'ok', 'p1', 1)
    const out = sanitizePresetsByRepo({
      r1: [preset, { id: 1 }, { id: 'p2', name: 'bad', cards: 'x' }],
      r2: 'nope'
    })
    expect(out.r1.map((p) => p.id)).toEqual(['p1'])
    expect(out.r1[0].cards).toHaveLength(3)
    expect(out.r2).toBeUndefined()
  })
})
