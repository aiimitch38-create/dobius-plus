import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GOAL_DRIFT_MIN_INTERVAL_MS,
  resetGoalDriftForTest,
  runGoalDriftCheck,
  useGoalDriftFlags,
  type GoalDriftJudge
} from './goal-drift'
import { goalCard } from './goal-test-fixtures'

const goal = goalCard('g', {
  driftCheck: true,
  dont: [{ id: 'd', text: 'Touch billing' }]
})
const run = (judge: GoalDriftJudge, over: Partial<Parameters<typeof runGoalDriftCheck>[0]> = {}) =>
  runGoalDriftCheck(
    {
      goal,
      tabId: 'tab-2',
      consoleName: 'Claude 2',
      report: 'Refactored billing.',
      now: 0,
      ...over
    },
    judge
  )

describe('runGoalDriftCheck', () => {
  beforeEach(() => resetGoalDriftForTest())

  it('asks the judge with the goal block and flags an off-goal report on the card', async () => {
    const judge = vi.fn<GoalDriftJudge>(async () => ({
      verdict: 'off-goal',
      reason: 'It is editing billing.',
      error: null
    }))
    const flag = await run(judge)
    expect(judge).toHaveBeenCalledWith({
      goalBlock: "Main goal: Ship the login page.\nDon't: Touch billing",
      consoleName: 'Claude 2',
      report: 'Refactored billing.'
    })
    expect(flag).toEqual({
      tabId: 'tab-2',
      consoleName: 'Claude 2',
      line: 'It is editing billing.',
      at: 0
    })
    expect(useGoalDriftFlags.getState().byGoal.g).toEqual([flag])
  })

  it('falls back to the report’s first line when the judge gives no reason', async () => {
    const flag = await run(async () => ({ verdict: 'off-goal', reason: null, error: null }), {
      report: '\n  Rewrote the billing page\nmore'
    })
    expect(flag?.line).toBe('Rewrote the billing page')
  })

  it('clears the console’s flag when a later report is back on goal', async () => {
    await run(async () => ({ verdict: 'off-goal', reason: 'x', error: null }))
    await run(async () => ({ verdict: 'on-goal', reason: null, error: null }), {
      now: GOAL_DRIFT_MIN_INTERVAL_MS
    })
    expect(useGoalDriftFlags.getState().byGoal.g).toEqual([])
  })

  it('does nothing when drift check is off, the report is empty, or it ran recently', async () => {
    const judge = vi.fn<GoalDriftJudge>(async () => ({
      verdict: 'off-goal',
      reason: 'x',
      error: null
    }))
    await runGoalDriftCheck(
      { goal: { ...goal, driftCheck: false }, tabId: 't', consoleName: 'c', report: 'r', now: 0 },
      judge
    )
    await run(judge, { report: '   ' })
    expect(judge).not.toHaveBeenCalled()
    await run(judge)
    await run(judge, { now: GOAL_DRIFT_MIN_INTERVAL_MS - 1 })
    expect(judge).toHaveBeenCalledTimes(1)
    await run(judge, { now: GOAL_DRIFT_MIN_INTERVAL_MS })
    expect(judge).toHaveBeenCalledTimes(2)
  })

  it('never raises a flag on an unclear answer or a judge failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(await run(async () => ({ verdict: null, reason: null, error: 'timeout' }))).toBeNull()
    expect(
      await run(
        async () => {
          throw new Error('ipc down')
        },
        { tabId: 'tab-3' }
      )
    ).toBeNull()
    expect(useGoalDriftFlags.getState().byGoal.g ?? []).toEqual([])
  })
})
