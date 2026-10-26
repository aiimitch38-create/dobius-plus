import { describe, expect, it } from 'vitest'
import type { BoardState } from '@/store/slices/board'
import { BOARD_TARGET_KEY, DEFAULT_LOOP_FORM, PICKED_TARGET_KEY } from './loop-form'
import {
  describeFormTarget,
  formatInterval,
  loopStopSummary,
  loopSummarySentence,
  targetRowOf
} from './loop-form-summary'

const board = {
  cards: [
    { id: 'c1', kind: 'console', tabId: 't1', title: 'Claude 1' },
    { id: 'c2', kind: 'console', tabId: 't2', title: 'Codex 1' },
    { id: 'c3', kind: 'console', tabId: 't3', title: 'Claude 2' },
    { id: 'o1', kind: 'orchestrator', name: 'Lead', wiredCardIds: ['c1', 'c2'] },
    { id: 'n', kind: 'note' }
  ],
  groups: [{ id: 'g1', name: 'Team A', color: 'blue', cardIds: ['c3'] }]
} as unknown as Pick<BoardState, 'cards' | 'groups'>

const form = { ...DEFAULT_LOOP_FORM, kind: 'schedule' as const, everyMin: 15 }

describe('formatInterval', () => {
  it('reads as minutes, whole hours, or both', () => {
    expect(formatInterval(15)).toBe('15 min')
    expect(formatInterval(60)).toBe('1 h')
    expect(formatInterval(120)).toBe('2 h')
    expect(formatInterval(90)).toBe('1 h 30 min')
    expect(formatInterval(0)).toBe('1 min')
  })
})

describe('describeFormTarget', () => {
  it('counts the consoles each row reaches right now', () => {
    expect(describeFormTarget({ targetKey: BOARD_TARGET_KEY, pickedTabIds: [] }, board)).toEqual({
      kind: 'board',
      count: 3
    })
    expect(describeFormTarget({ targetKey: 'orchestrator:o1', pickedTabIds: [] }, board)).toEqual({
      kind: 'orchestrator',
      name: 'Lead',
      count: 2
    })
    expect(describeFormTarget({ targetKey: 'group:g1', pickedTabIds: [] }, board)).toEqual({
      kind: 'group',
      name: 'Team A',
      count: 1
    })
    expect(
      describeFormTarget({ targetKey: PICKED_TARGET_KEY, pickedTabIds: ['t2'] }, board)
    ).toEqual({ kind: 'picked', count: 1, title: 'Codex 1' })
    expect(
      describeFormTarget({ targetKey: PICKED_TARGET_KEY, pickedTabIds: ['t1', 't3'] }, board)
    ).toEqual({ kind: 'picked', count: 2, title: null })
    expect(describeFormTarget({ targetKey: PICKED_TARGET_KEY, pickedTabIds: [] }, board)).toEqual({
      kind: 'none'
    })
  })
})

describe('loopSummarySentence (sticky footer)', () => {
  it('schedule: the reference sentence', () => {
    expect(loopSummarySentence(form, { kind: 'board', count: 5 })).toBe(
      'Every 15 min, the instruction is sent to every console on the board.'
    )
    expect(
      loopSummarySentence(
        { ...form, everyMin: 60 },
        { kind: 'orchestrator', name: 'Lead', count: 2 }
      )
    ).toBe('Every 1 h, the instruction is sent to every console wired to Lead.')
    expect(loopSummarySentence(form, { kind: 'picked', count: 3, title: null })).toBe(
      'Every 15 min, the instruction is sent to 3 picked consoles.'
    )
    expect(loopSummarySentence(form, { kind: 'picked', count: 1, title: 'Codex 1' })).toBe(
      'Every 15 min, the instruction is sent to Codex 1.'
    )
  })
  it('idle: one console versus all of several', () => {
    const idle = { ...form, kind: 'on-idle' as const }
    expect(loopSummarySentence(idle, { kind: 'picked', count: 1, title: 'Codex 1' })).toBe(
      'Whenever Codex 1 finishes and goes idle, the instruction is sent to it.'
    )
    expect(loopSummarySentence(idle, { kind: 'board', count: 3 })).toBe(
      'Once every console on the board have all gone idle, the instruction is sent to them.'
    )
  })
  it('output match: names the pattern and tells only the matching console', () => {
    const match = { ...form, kind: 'on-output-match' as const, pattern: 'FAILED' }
    expect(loopSummarySentence(match, { kind: 'board', count: 3 })).toBe(
      'The moment one of every console on the board prints “FAILED”, that console is told.'
    )
    expect(loopSummarySentence(match, { kind: 'picked', count: 1, title: 'Codex 1' })).toBe(
      'The moment Codex 1 prints “FAILED”, it is told.'
    )
    expect(loopSummarySentence({ ...match, pattern: ' ' }, { kind: 'board', count: 3 })).toContain(
      'prints matching text'
    )
  })
  it('a judged goal says who decides it is done', () => {
    expect(
      loopSummarySentence(
        { ...form, stopGoalOn: true, stopGoalMode: 'judge' },
        { kind: 'board', count: 2 }
      )
    ).toBe(
      'Every 15 min, the instruction is sent to every console on the board until a separate agent judges the goal met.'
    )
  })
})

describe('loopStopSummary (STOP box)', () => {
  it('no rule: the reference line', () => {
    expect(loopStopSummary(form, null)).toBe(
      'No stop condition. The loop runs until you switch it off.'
    )
  })
  it('joins every active rule', () => {
    expect(loopStopSummary({ ...form, stopAfterRuns: 10, stopAfterMin: 120 }, null)).toBe(
      'Stops after 10 runs, or after 2 h.'
    )
    expect(
      loopStopSummary(
        { ...form, stopGoalOn: true, stopGoalMode: 'card', stopGoalCardId: 'g' },
        'Ship v2'
      )
    ).toBe('Stops once every item on “Ship v2” is checked.')
    expect(
      loopStopSummary(
        { ...form, stopGoalOn: true, stopGoalMode: 'command', stopCommand: 'pnpm test' },
        null
      )
    ).toBe('Stops once `pnpm test` passes.')
    expect(loopStopSummary({ ...form, stopGoalOn: true, stopGoalMode: 'judge' }, null)).toBe(
      'Stops once a separate agent judges the goal met.'
    )
  })
  it('a toggled-on goal with nothing picked yet still reads as a rule', () => {
    expect(loopStopSummary({ ...form, stopGoalOn: true, stopGoalMode: 'card' }, null)).toBe(
      'Stops once a goal card you pick is complete.'
    )
  })
})

describe('targetRowOf', () => {
  it('maps every key to its TARGET row', () => {
    expect(targetRowOf(BOARD_TARGET_KEY)).toBe('board')
    expect(targetRowOf('orchestrator:o1')).toBe('orchestrator')
    expect(targetRowOf(PICKED_TARGET_KEY)).toBe('picked')
    expect(targetRowOf('tab:t1')).toBe('picked')
    expect(targetRowOf('group:g1')).toBe('group')
  })
})
