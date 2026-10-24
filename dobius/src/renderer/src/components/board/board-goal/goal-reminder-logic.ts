// Pure reminder rules for goal cards, one track per console. The engine
// (goal-reminder-engine.ts) feeds it the agent-status feed and delivers.
import type { BoardGoalReminders } from '@/store/slices/board'
import type { ConsoleDeliveryState } from '../board-delivery/delivery-gate'

/** Never more than one goal reminder per console in this window. */
export const GOAL_REMINDER_THROTTLE_MS = 2 * 60 * 1000

export type GoalReminderReason = 'compaction' | 'turns' | 'manual'

export type ConsoleReminderTrack = {
  /** stateStartedAt of the last "done" counted; null before the first one is seen. */
  lastDoneStartedAt: number | null
  /** Completed turns since the last reminder. */
  turns: number
  lastRemindedAt: number | null
  pending: GoalReminderReason | null
}

export const EMPTY_REMINDER_TRACK: ConsoleReminderTrack = Object.freeze({
  lastDoneStartedAt: null,
  turns: 0,
  lastRemindedAt: null,
  pending: null
})

/** Several goals on one console: a trigger is on when any goal turns it on; the shortest turn cadence wins. */
export function mergeReminderPolicies(policies: readonly BoardGoalReminders[]): BoardGoalReminders {
  const cadences = policies.map((p) => p.everyTurns).filter((n) => n > 0)
  return {
    afterCompaction: policies.some((p) => p.afterCompaction),
    everyTurns: cadences.length > 0 ? Math.min(...cadences) : 0,
    onNewTask: policies.some((p) => p.onNewTask)
  }
}

export type StatusSample = { state: string; stateStartedAt: number } | null

/**
 * Counts one completed turn per new "done" episode (a working→done transition
 * reported by the agent hooks) and arms a turns reminder at the cadence.
 */
export function observeTurn(
  track: ConsoleReminderTrack,
  sample: StatusSample,
  policy: BoardGoalReminders
): { track: ConsoleReminderTrack; completed: boolean } {
  if (!sample || sample.state !== 'done' || sample.stateStartedAt === track.lastDoneStartedAt) {
    return { track, completed: false }
  }
  const turns = track.turns + 1
  const due = policy.everyTurns > 0 && turns >= policy.everyTurns
  return {
    track: {
      ...track,
      lastDoneStartedAt: sample.stateStartedAt,
      turns,
      pending: track.pending ?? (due ? 'turns' : null)
    },
    completed: true
  }
}

/** First sight of a console: remember its current done episode so an old turn is not counted. */
export function baselineTrack(sample: StatusSample): ConsoleReminderTrack {
  return {
    ...EMPTY_REMINDER_TRACK,
    lastDoneStartedAt: sample?.state === 'done' ? sample.stateStartedAt : null
  }
}

/** The agent compacted its context: arm a reminder when that trigger is on. */
export function noteCompaction(
  track: ConsoleReminderTrack,
  policy: BoardGoalReminders
): ConsoleReminderTrack {
  return policy.afterCompaction ? { ...track, pending: 'compaction' } : track
}

export function requestManualReminder(track: ConsoleReminderTrack): ConsoleReminderTrack {
  return { ...track, pending: 'manual' }
}

export function throttled(track: ConsoleReminderTrack, now: number): boolean {
  return track.lastRemindedAt !== null && now - track.lastRemindedAt < GOAL_REMINDER_THROTTLE_MS
}

export type ReminderGate =
  /** Nothing armed. */
  | 'none'
  | 'send'
  /** Keep it armed: the agent is busy, on a dialog, paused, or reminded too recently. */
  | 'wait'
  /** Disarm: no agent runs in this console (bare shell or gone). */
  | 'drop'

export function reminderGate(
  track: ConsoleReminderTrack,
  input: { now: number; state: ConsoleDeliveryState; hasAgent: boolean }
): ReminderGate {
  if (track.pending === null) {
    return 'none'
  }
  if (!input.hasAgent || input.state === 'shell' || input.state === 'gone') {
    return 'drop'
  }
  // Why: a reminder is never typed into a turn in progress or over a dialog; it waits for idle.
  if (input.state !== 'idle' && input.state !== 'done') {
    return 'wait'
  }
  return throttled(track, input.now) ? 'wait' : 'send'
}

export function markReminded(track: ConsoleReminderTrack, now: number): ConsoleReminderTrack {
  return { ...track, turns: 0, pending: null, lastRemindedAt: now }
}

export function disarm(track: ConsoleReminderTrack): ConsoleReminderTrack {
  return track.pending === null ? track : { ...track, pending: null }
}

/** Whether a new task handed to this console should carry the goal block. */
export function taskCarriesGoal(
  track: ConsoleReminderTrack,
  policy: BoardGoalReminders,
  now: number
): boolean {
  return policy.onNewTask && !throttled(track, now)
}
