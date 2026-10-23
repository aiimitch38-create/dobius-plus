import { describe, expect, it } from 'vitest'
import { newLoopState } from '../../../../../shared/automation-loops'
import type { BoardState } from '@/store/slices/board'
import {
  DEFAULT_LOOP_FORM,
  buildLoopTrigger,
  describeNextFire,
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
  it('validates output patterns and requires a single tab', () => {
    expect(buildLoopTrigger({ ...form, kind: 'on-output-match', pattern: '(' }).ok).toBe(false)
    expect(
      buildLoopTrigger({ ...form, kind: 'on-output-match', pattern: 'x'.repeat(201) }).ok
    ).toBe(false)
    expect(
      buildLoopTrigger({ ...form, kind: 'on-output-match', pattern: 'FAIL', targetKey: 'group:g' })
        .ok
    ).toBe(false)
    expect(buildLoopTrigger({ ...form, kind: 'on-output-match', pattern: 'FAIL' })).toMatchObject({
      ok: true,
      trigger: { kind: 'on-output-match', tabId: 't1', cooldownMs: 60_000 }
    })
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
  it('resolves tabs and group members', () => {
    expect(loopTargetTabIds({ type: 'tab', tabId: 'x' }, board)).toEqual(['x'])
    expect(loopTargetTabIds({ type: 'group', groupId: 'g' }, board)).toEqual(['t2'])
    expect(loopTargetTabIds({ type: 'group', groupId: 'none' }, board)).toEqual([])
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
