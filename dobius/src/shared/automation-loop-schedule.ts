// Schedule trigger and time-limit stop for Board loops (pure, shared by main and renderer).
import type { AutomationLoop, AutomationLoopState } from './automations-types'
import { isLoopActive } from './automation-loops'

/**
 * A schedule loop is due once `everyMs` has passed since its last run, or since
 * it was created when it has never run (so saving a loop never types instantly).
 */
export function scheduleDue(
  state: AutomationLoopState,
  createdAt: number,
  now: number,
  everyMs: number
): boolean {
  return isLoopActive(state) && now - (state.lastFiredAt ?? createdAt) >= everyMs
}

/** True once a loop with a time limit has outlived it (it should retire, not fire). */
export function loopTimeUp(loop: AutomationLoop, createdAt: number, now: number): boolean {
  return loop.stopAfterMs !== undefined && now - createdAt >= loop.stopAfterMs
}
