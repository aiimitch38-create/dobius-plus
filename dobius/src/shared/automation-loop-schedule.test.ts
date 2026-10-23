import { describe, expect, it } from 'vitest'
import { scheduleDue } from './automation-loop-schedule'
import { newLoopState, normalizeAutomationLoop } from './automation-loops'

describe('schedule loops', () => {
  it('normalizes a schedule trigger with a board target and clamps the interval', () => {
    const loop = normalizeAutomationLoop({
      worktreeId: 'wt',
      trigger: { kind: 'schedule', target: { type: 'board' }, everyMs: 5 }
    })
    expect(loop?.trigger).toEqual({ kind: 'schedule', target: { type: 'board' }, everyMs: 60_000 })
    const long = normalizeAutomationLoop({
      worktreeId: 'wt',
      trigger: { kind: 'schedule', target: { type: 'group', groupId: 'g' }, everyMs: 1e12 }
    })
    expect(long?.trigger.kind === 'schedule' && long.trigger.everyMs).toBe(24 * 60 * 60 * 1000)
    expect(
      normalizeAutomationLoop({
        worktreeId: 'wt',
        trigger: { kind: 'schedule', target: { type: 'x' } }
      })
    ).toBeNull()
  })

  it('is due an interval after creation, then an interval after each run', () => {
    const state = newLoopState()
    expect(scheduleDue(state, 0, 59_000, 60_000)).toBe(false)
    expect(scheduleDue(state, 0, 60_000, 60_000)).toBe(true)
    expect(scheduleDue({ ...state, lastFiredAt: 100_000 }, 0, 150_000, 60_000)).toBe(false)
    expect(scheduleDue({ ...state, lastFiredAt: 100_000 }, 0, 160_000, 60_000)).toBe(true)
    expect(scheduleDue({ ...state, paused: true }, 0, 1e9, 60_000)).toBe(false)
  })
})
