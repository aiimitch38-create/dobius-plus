// Board loop types: an automation whose run is triggered by board events.
// Re-exported from automations-types so existing imports keep working.
export type AutomationLoopTriggerKind = 'on-idle' | 'on-output-match' | 'goal' | 'schedule'

/** Board loop target: one console tab, every console in a Board group, or
 *  every console on the board (resolved at fire time, so later consoles count). */
export type AutomationLoopTarget =
  | { type: 'tab'; tabId: string }
  | { type: 'group'; groupId: string }
  | { type: 'board' }
  /** The consoles wired to one orchestrator card, resolved at fire time. */
  | { type: 'orchestrator'; cardId: string }

export type AutomationLoopTrigger =
  | { kind: 'on-idle'; target: AutomationLoopTarget; debounceMs: number }
  | { kind: 'on-output-match'; tabId: string; pattern: string; cooldownMs: number }
  | {
      kind: 'goal'
      target: AutomationLoopTarget
      goal: string
      checkEveryMs: number
      maxRuns: number
    }
  /** Fires every `everyMs`, first one `everyMs` after the loop is created. */
  | { kind: 'schedule'; target: AutomationLoopTarget; everyMs: number }

export type AutomationLoopState = {
  paused: boolean
  runCount: number
  lastFiredAt: number | null
  /** Terminal read cursor (output-match / goal); output before it was already judged. */
  outputCursor: string | null
  retiredAt: number | null
  lastResult: string | null
  /** Goal loops: the agent's latest DOBIUS_GOAL answer since the last run. */
  lastVerdict: 'met' | 'not-met' | null
}

/** Why: a loop is an automation whose run is triggered by board events instead
 *  of its rrule; absent on every pre-loop automation, which stays schedule-driven. */
export type AutomationLoop = {
  worktreeId: string
  trigger: AutomationLoopTrigger
  state: AutomationLoopState
  /** Time-limit stop: the loop retires this long after it was created. */
  stopAfterMs?: number
}
