import { BrowserWindow, Notification } from 'electron'
import type { AutomationLoopTrigger } from '../../shared/automations-types'

// Why: a console on a permission prompt is never typed into; the loop holds and
// retries soon (schedule loops) instead of waiting a whole interval.
export const HOLD_RETRY_MS = 30_000
export const HELD_RESULT =
  'Held: a console is waiting on a permission prompt. Retrying after you answer.'

export function notifyLoopHeldByDefault(loopName: string): void {
  if (typeof Notification !== 'function' || !Notification.isSupported()) {
    return
  }
  // Why: the system notice is for when the user is away; in-app, the loop row says "Held".
  if (BrowserWindow.getFocusedWindow()) {
    return
  }
  new Notification({
    title: 'Loop on hold',
    body: `"${loopName}" is waiting: a console needs your answer before it can continue.`
  }).show()
}

/** Remembers which loops are held so the user is notified once per hold, not per retry. */
export class LoopHolds {
  private readonly held = new Set<string>()

  constructor(private readonly notify: (loopName: string) => void) {}

  track(automationId: string, loopName: string, heldNow: boolean): void {
    if (heldNow && !this.held.has(automationId)) {
      this.held.add(automationId)
      this.notify(loopName)
    } else if (!heldNow) {
      this.held.delete(automationId)
    }
  }
}

/** lastFiredAt to record: a held schedule loop comes due again in HOLD_RETRY_MS. */
export function heldFiredAt(trigger: AutomationLoopTrigger, now: number, heldNow: boolean): number {
  return heldNow && trigger.kind === 'schedule'
    ? now - Math.max(0, trigger.everyMs - HOLD_RETRY_MS)
    : now
}
