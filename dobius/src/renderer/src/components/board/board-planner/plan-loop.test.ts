import { describe, expect, it } from 'vitest'
import type { BoardState } from '@/store/slices/board'
import { BOARD_TARGET_KEY } from '../board-loops/loop-form'
import { BOARD } from './plan-fixtures.test-support'
import { planLoop, plannedLoopSummary } from './plan-loop'
import { resolveTarget } from './plan-target'

const board = {
  cards: [
    { id: 'c1', kind: 'console', tabId: 'tab-1', title: 'Claude 1', agentKind: 'claude' },
    { id: 'c2', kind: 'console', tabId: 'tab-2', title: 'Claude 2', agentKind: 'claude' },
    { id: 'c3', kind: 'console', tabId: 'tab-3', title: 'Codex 1', agentKind: 'codex' }
  ],
  groups: [{ id: 'g1', name: 'Team A', cardIds: ['c1', 'c2'] }]
} as unknown as Pick<BoardState, 'cards' | 'groups'>

const loop = (target: string | null, stopCommand: string | null = null) =>
  planLoop(
    {
      text: 'run the tests',
      intervalMinutes: 10,
      target: target ? resolveTarget(target, BOARD) : null,
      stopCommand
    },
    board
  )

describe('planLoop', () => {
  it('makes a schedule loop on every console by default', () => {
    const r = loop(null)
    expect(r.ok && r.loop.form.targetKey).toBe(BOARD_TARGET_KEY)
    expect(r.ok && r.loop.trigger).toEqual({
      kind: 'schedule',
      target: { type: 'board' },
      everyMs: 600_000
    })
  })

  it('targets one console by tab, or a group by id', () => {
    const one = loop('Codex 1')
    expect(one.ok && one.loop.trigger).toMatchObject({ target: { type: 'tab', tabId: 'tab-3' } })
    expect(one.ok && one.loop.agentKind).toBe('codex')
    const group = loop('Team A')
    expect(group.ok && group.loop.trigger).toMatchObject({
      target: { type: 'group', groupId: 'g1' }
    })
  })

  it('refuses targets a loop cannot address (an agent kind spanning consoles)', () => {
    expect(loop('claude').ok).toBe(false)
  })

  it('keeps a safe stop command and rejects a destructive one', () => {
    const safe = loop(null, 'pnpm test')
    expect(safe.ok && safe.loop.stop).toEqual({ stopCommand: 'pnpm test' })
    expect(safe.ok && plannedLoopSummary(safe.loop)).toContain('pnpm test')
    expect(loop(null, 'rm -rf build').ok).toBe(false)
    expect(loop(null, 'git push').ok).toBe(false)
  })
})
