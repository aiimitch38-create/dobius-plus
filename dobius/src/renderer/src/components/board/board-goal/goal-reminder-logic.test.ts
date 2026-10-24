import { describe, expect, it } from 'vitest'
import {
  EMPTY_REMINDER_TRACK,
  GOAL_REMINDER_THROTTLE_MS,
  baselineTrack,
  markReminded,
  mergeReminderPolicies,
  noteCompaction,
  observeTurn,
  reminderGate,
  taskCarriesGoal
} from './goal-reminder-logic'

const policy = { afterCompaction: true, everyTurns: 2, onNewTask: true }
const done = (at: number) => ({ state: 'done', stateStartedAt: at })

describe('goal reminder rules', () => {
  it('counts each new done episode once and arms at the cadence', () => {
    let track = baselineTrack(done(1))
    expect(observeTurn(track, done(1), policy).completed).toBe(false)
    expect(observeTurn(track, { state: 'working', stateStartedAt: 2 }, policy).completed).toBe(
      false
    )
    track = observeTurn(track, done(3), policy).track
    expect(track).toMatchObject({ turns: 1, pending: null })
    track = observeTurn(track, done(4), policy).track
    expect(track).toMatchObject({ turns: 2, pending: 'turns' })
    expect(observeTurn(track, null, policy).completed).toBe(false)
  })

  it('merges several goals on one console', () => {
    expect(
      mergeReminderPolicies([
        { afterCompaction: false, everyTurns: 0, onNewTask: false },
        { afterCompaction: true, everyTurns: 7, onNewTask: false },
        { afterCompaction: false, everyTurns: 3, onNewTask: true }
      ])
    ).toEqual({ afterCompaction: true, everyTurns: 3, onNewTask: true })
    expect(mergeReminderPolicies([])).toEqual({
      afterCompaction: false,
      everyTurns: 0,
      onNewTask: false
    })
  })

  it('gates: send only to an idle agent outside the throttle; never into shells', () => {
    const armed = noteCompaction(EMPTY_REMINDER_TRACK, policy)
    const gate = (state: Parameters<typeof reminderGate>[1]['state'], hasAgent = true, now = 0) =>
      reminderGate(armed, { now, state, hasAgent })
    expect(reminderGate(EMPTY_REMINDER_TRACK, { now: 0, state: 'idle', hasAgent: true })).toBe(
      'none'
    )
    expect(gate('idle')).toBe('send')
    expect(gate('done')).toBe('send')
    for (const busy of ['working', 'waiting', 'blocked', 'paused'] as const) {
      expect(gate(busy)).toBe('wait')
    }
    expect(gate('shell')).toBe('drop')
    expect(gate('gone')).toBe('drop')
    expect(gate('idle', false)).toBe('drop')
    const recent = { ...armed, lastRemindedAt: 100 }
    expect(
      reminderGate(recent, {
        now: 100 + GOAL_REMINDER_THROTTLE_MS - 1,
        state: 'idle',
        hasAgent: true
      })
    ).toBe('wait')
    expect(
      reminderGate(recent, { now: 100 + GOAL_REMINDER_THROTTLE_MS, state: 'idle', hasAgent: true })
    ).toBe('send')
  })

  it('a delivered reminder resets the turn count; tasks carry the goal outside the throttle', () => {
    const track = markReminded({ ...EMPTY_REMINDER_TRACK, turns: 4, pending: 'turns' }, 50)
    expect(track).toEqual({ lastDoneStartedAt: null, turns: 0, pending: null, lastRemindedAt: 50 })
    expect(taskCarriesGoal(track, policy, 51)).toBe(false)
    expect(taskCarriesGoal(track, policy, 50 + GOAL_REMINDER_THROTTLE_MS)).toBe(true)
    expect(taskCarriesGoal(track, { ...policy, onNewTask: false }, 1e12)).toBe(false)
    expect(noteCompaction(track, { ...policy, afterCompaction: false }).pending).toBeNull()
  })
})
