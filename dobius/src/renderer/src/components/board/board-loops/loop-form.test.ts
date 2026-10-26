import { describe, expect, it } from 'vitest'
import { newLoopState } from '../../../../../shared/automation-loops'
import type { BoardState } from '@/store/slices/board'
import {
  DEFAULT_LOOP_FORM,
  PICKED_TARGET_KEY,
  buildLoopTrigger,
  describeNextFire,
  formTarget,
  isJudgedGoalForm,
  loopStopFields,
  loopTargetTabIds,
  parseTargetKey,
  targetIsWorking
} from './loop-form'

describe('parseTargetKey', () => {
  it('parses tab and group keys, rejects junk', () => {
    expect(parseTargetKey('tab:t1')).toEqual({ type: 'tab', tabId: 't1' })
    expect(parseTargetKey('group:g:1')).toEqual({ type: 'group', groupId: 'g:1' })
    expect(parseTargetKey('tab:')).toBeNull()
    expect(parseTargetKey('x:1')).toBeNull()
  })
})

describe('buildLoopTrigger', () => {
  const form = { ...DEFAULT_LOOP_FORM, targetKey: 'tab:t1', instruction: 'go' }
  it('builds on-idle with a debounce floor', () => {
    expect(buildLoopTrigger({ ...form, debounceSec: 0 })).toEqual({
      ok: true,
      trigger: { kind: 'on-idle', target: { type: 'tab', tabId: 't1' }, debounceMs: 1000 }
    })
  })
  it('validates output patterns and watches whichever target is picked', () => {
    expect(buildLoopTrigger({ ...form, kind: 'on-output-match', pattern: '(' }).ok).toBe(false)
    expect(
      buildLoopTrigger({ ...form, kind: 'on-output-match', pattern: 'x'.repeat(201) }).ok
    ).toBe(false)
    expect(
      buildLoopTrigger({ ...form, kind: 'on-output-match', pattern: 'FAIL', targetKey: 'group:g' })
    ).toMatchObject({ ok: true, trigger: { target: { type: 'group', groupId: 'g' } } })
    expect(buildLoopTrigger({ ...form, kind: 'on-output-match', pattern: 'FAIL' })).toMatchObject({
      ok: true,
      trigger: {
        kind: 'on-output-match',
        target: { type: 'tab', tabId: 't1' },
        pattern: 'FAIL',
        cooldownMs: 60_000
      }
    })
  })
  it('"Pick consoles": one picked console is a tab target, several are a tabs target, none is an error', () => {
    const picked = { ...form, targetKey: PICKED_TARGET_KEY }
    expect(formTarget({ ...picked, pickedTabIds: ['a'] })).toEqual({ type: 'tab', tabId: 'a' })
    expect(formTarget({ ...picked, pickedTabIds: ['a', 'b', 'a'] })).toEqual({
      type: 'tabs',
      tabIds: ['a', 'b']
    })
    expect(buildLoopTrigger({ ...picked, pickedTabIds: [] })).toEqual({
      ok: false,
      error: 'Pick at least one console.'
    })
    expect(
      buildLoopTrigger({ ...picked, kind: 'schedule', pickedTabIds: ['a', 'b'] })
    ).toMatchObject({ ok: true, trigger: { target: { type: 'tabs', tabIds: ['a', 'b'] } } })
  })
  it('schedule + "an agent judges a goal" saves as an agent-judged goal loop', () => {
    const judged = {
      ...form,
      kind: 'schedule' as const,
      everyMin: 10,
      stopGoalOn: true,
      stopGoalMode: 'judge' as const
    }
    expect(buildLoopTrigger(judged)).toEqual({ ok: false, error: 'Describe the goal.' })
    expect(buildLoopTrigger({ ...judged, goal: ' ship ' })).toEqual({
      ok: true,
      trigger: {
        kind: 'goal',
        target: { type: 'tab', tabId: 't1' },
        goal: 'ship',
        checkEveryMs: 600_000,
        maxRuns: 50,
        judge: 'agent'
      }
    })
    expect(buildLoopTrigger({ ...judged, goal: 'ship', stopAfterRuns: 4 })).toMatchObject({
      ok: true,
      trigger: { maxRuns: 4 }
    })
    expect(buildLoopTrigger({ ...judged, kind: 'on-idle', goal: 'ship' }).ok).toBe(false)
    expect(isJudgedGoalForm(judged)).toBe(true)
    expect(isJudgedGoalForm({ ...judged, stopGoalOn: false })).toBe(false)
  })
  it('builds goal loops with clamped limits and requires a goal', () => {
    expect(buildLoopTrigger({ ...form, kind: 'goal' }).ok).toBe(false)
    expect(
      buildLoopTrigger({ ...form, kind: 'goal', goal: ' ship ', maxRuns: 500, checkEverySec: 1 })
    ).toMatchObject({
      ok: true,
      trigger: { goal: 'ship', maxRuns: 50, checkEveryMs: 30_000 }
    })
  })
  it('requires a target and an instruction', () => {
    expect(buildLoopTrigger({ ...form, targetKey: '' }).ok).toBe(false)
    expect(buildLoopTrigger({ ...form, instruction: ' ' }).ok).toBe(false)
  })
})

describe('loopTargetTabIds', () => {
  const board = {
    cards: [
      { id: 'c1', kind: 'console', tabId: 't1' },
      { id: 'c2', kind: 'console', tabId: 't2' },
      { id: 'n', kind: 'note' }
    ],
    groups: [{ id: 'g', name: 'G', color: 'blue', cardIds: ['c2', 'n'] }]
  } as unknown as BoardState
  it('resolves tabs, picked tabs and group members', () => {
    expect(loopTargetTabIds({ type: 'tab', tabId: 'x' }, board)).toEqual(['x'])
    expect(loopTargetTabIds({ type: 'tabs', tabIds: ['t1', 't2', 'gone'] }, board)).toEqual([
      't1',
      't2'
    ])
    expect(loopTargetTabIds({ type: 'group', groupId: 'g' }, board)).toEqual(['t2'])
    expect(loopTargetTabIds({ type: 'group', groupId: 'none' }, board)).toEqual([])
  })
})

describe('loopStopFields with the "When a goal is met" toggle', () => {
  const base = { kind: 'schedule' as const, stopAfterMin: 0, stopAfterRuns: 0, stopCommand: '' }
  it('saves the goal card and drops a leftover command from the other mode', () => {
    expect(
      loopStopFields({
        ...base,
        stopGoalOn: true,
        stopGoalMode: 'card',
        stopGoalCardId: ' goal-1 ',
        stopCommand: 'pnpm test'
      })
    ).toEqual({ ok: true, fields: { stopGoalCardId: 'goal-1' } })
    expect(loopStopFields({ ...base, stopGoalOn: true, stopGoalMode: 'card' })).toEqual({
      ok: false,
      error: 'Pick the goal card that ends this loop.'
    })
  })
  it('command mode needs a command; a judged goal keeps its run cap on the trigger', () => {
    expect(loopStopFields({ ...base, stopGoalOn: true, stopGoalMode: 'command' })).toEqual({
      ok: false,
      error: 'Enter the command that ends this loop.'
    })
    expect(
      loopStopFields({
        ...base,
        stopGoalOn: true,
        stopGoalMode: 'command',
        stopCommand: 'pnpm test'
      })
    ).toEqual({ ok: true, fields: { stopCommand: 'pnpm test' } })
    expect(
      loopStopFields({ ...base, stopAfterRuns: 4, stopGoalOn: true, stopGoalMode: 'judge' })
    ).toEqual({ ok: true, fields: {} })
  })
  it('the toggle off clears nothing the planner set directly', () => {
    expect(loopStopFields({ ...base, stopGoalOn: false, stopCommand: 'pnpm test' })).toEqual({
      ok: true,
      fields: { stopCommand: 'pnpm test' }
    })
  })
})

describe('targetIsWorking', () => {
  it('matches fresh working panes of the target tabs only', () => {
    const status = {
      't1:leaf': { state: 'working', updatedAt: 90 },
      't10:leaf': { state: 'working', updatedAt: 90 }
    }
    expect(targetIsWorking(status, ['t1'], 100, 50)).toBe(true)
    expect(targetIsWorking(status, ['t2'], 100, 50)).toBe(false)
    expect(targetIsWorking(status, ['t1'], 1000, 50)).toBe(false)
    expect(targetIsWorking({ 't1:l': { state: 'done', updatedAt: 99 } }, ['t1'], 100, 50)).toBe(
      false
    )
  })
})

describe('describeNextFire', () => {
  const goal = {
    worktreeId: 'w',
    trigger: {
      kind: 'goal' as const,
      target: { type: 'tab' as const, tabId: 't' },
      goal: 'g',
      checkEveryMs: 60_000,
      maxRuns: 3
    },
    state: { ...newLoopState(), runCount: 1, lastFiredAt: 0 }
  }
  it('reports paused, finished and the goal countdown', () => {
    expect(describeNextFire(goal, false, 0)).toBe('Paused')
    expect(describeNextFire({ ...goal, state: { ...goal.state, retiredAt: 1 } }, true, 0)).toBe(
      'Finished'
    )
    expect(describeNextFire(goal, true, 15_000)).toBe('Check in 45s · run 1 of 3')
  })
})
