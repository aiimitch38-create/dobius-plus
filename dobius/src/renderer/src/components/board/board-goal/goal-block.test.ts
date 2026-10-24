import { describe, expect, it } from 'vitest'
import { formatGoalBlock, goalProgress } from './goal-block'
import { boardOf, consoleCard, goalCard, orchestratorCard } from './goal-test-fixtures'
import { goalContextFor, goalTargetConsoles, goalsForConsole } from './goal-targets'

const criteria = [
  { id: '1', text: 'Tests pass', done: true },
  { id: '2', text: 'Login  works\non mobile', done: false },
  { id: '3', text: '   ', done: false },
  { id: '4', text: 'Docs updated', done: false, evidence: 'PR 12' }
]

describe('formatGoalBlock', () => {
  it('lists the goal, only unchecked criteria, and the don’t list, one line each', () => {
    const block = formatGoalBlock([
      goalCard('g', {
        goal: '  Ship the\nlogin page. ',
        criteria,
        dont: [
          { id: 'd1', text: 'Touch billing' },
          { id: 'd2', text: '' }
        ]
      })
    ])
    expect(block).toBe(
      [
        'Main goal: Ship the login page.',
        'Done means: Login works on mobile; Docs updated',
        "Don't: Touch billing"
      ].join('\n')
    )
  })

  it('drops empty sections and goals without text, and joins several goals', () => {
    expect(formatGoalBlock([goalCard('a', { goal: '  ' })])).toBeNull()
    expect(formatGoalBlock([])).toBeNull()
    expect(formatGoalBlock([goalCard('a', { goal: 'A' }), goalCard('b', { goal: 'B' })])).toBe(
      'Main goal: A\n\nMain goal: B'
    )
  })

  it('counts progress over criteria with text', () => {
    expect(goalProgress({ criteria })).toEqual({ done: 1, total: 3 })
  })
})

describe('goal targets', () => {
  const board = boardOf(
    [
      consoleCard('a', 'Claude 1'),
      consoleCard('b', 'Claude 2'),
      consoleCard('c', 'Claude 3'),
      consoleCard('d', 'Claude 4'),
      orchestratorCard('o', ['d']),
      goalCard('g1', { goal: 'Group goal', wiredCardIds: ['grp'] }),
      goalCard('g2', { goal: 'Orchestrated goal', wiredCardIds: ['o'] }),
      goalCard('g3', { goal: 'Direct goal', wiredCardIds: ['a', 'gone'] })
    ],
    [{ id: 'grp', name: 'Team', color: 'blue', cardIds: ['b', 'c'] }]
  )

  it('wiring a group reaches all its members; an orchestrator reaches its consoles', () => {
    expect(goalTargetConsoles(board, ['grp']).map((c) => c.id)).toEqual(['b', 'c'])
    expect(goalTargetConsoles(board, ['o']).map((c) => c.id)).toEqual(['d'])
    expect(goalTargetConsoles(board, ['a', 'grp', 'b', 'gone']).map((c) => c.id)).toEqual([
      'a',
      'b',
      'c'
    ])
  })

  it('finds the goals reaching a console', () => {
    expect(goalsForConsole(board, 'c').map((g) => g.id)).toEqual(['g1'])
    expect(goalsForConsole(board, 'a').map((g) => g.id)).toEqual(['g3'])
  })

  it('goalContextFor accepts a console card id, a tab id, a goal id or an orchestrator id', () => {
    expect(goalContextFor(board, 'b')).toBe('Main goal: Group goal')
    expect(goalContextFor(board, 'tab-b')).toBe('Main goal: Group goal')
    expect(goalContextFor(board, 'g3')).toBe('Main goal: Direct goal')
    expect(goalContextFor(board, 'o')).toBe('Main goal: Orchestrated goal')
    expect(goalContextFor(board, 'tab-d')).toBe('Main goal: Orchestrated goal')
    expect(goalContextFor(board, 'nobody')).toBeNull()
  })
})
