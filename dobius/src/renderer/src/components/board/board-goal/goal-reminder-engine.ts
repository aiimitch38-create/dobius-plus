// Goal reminders over the agent-status feed. Injected deps keep it testable;
// goal-reminders.ts wires it to the app store and the Board delivery gate.
import type { BoardState } from '@/store/slices/board'
import type { AgentStatusEntry } from '../../../../../shared/agent-status-types'
import type { ConsoleDeliveryState, DeliveryOutcome } from '../board-delivery/delivery-gate'
import { formatGoalBlock } from './goal-block'
import {
  EMPTY_REMINDER_TRACK,
  baselineTrack,
  disarm,
  markReminded,
  mergeReminderPolicies,
  noteCompaction,
  observeTurn,
  reminderGate,
  requestManualReminder,
  taskCarriesGoal,
  throttled,
  type ConsoleReminderTrack
} from './goal-reminder-logic'
import { goalTargetConsoles } from './goal-targets'
import { goalWiringByTab, type ConsoleGoalWiring } from './goal-wiring'

export type GoalReminderDeps = {
  boards: () => Readonly<Record<string, BoardState>>
  statusOf: (tabId: string) => AgentStatusEntry | null
  stateOf: (tabId: string) => ConsoleDeliveryState
  /** Types through the Board delivery gate (never a direct terminal write). */
  enqueue: (tabId: string, text: string) => Promise<DeliveryOutcome>
  now: () => number
  onTurnCompleted?: (wiring: ConsoleGoalWiring, entry: AgentStatusEntry) => void
}

export type RemindNowSummary = { queued: number; waiting: number; noAgent: number }

/** Lead line so the agent reads the block as a reminder, not a new task. */
export function goalReminderText(block: string): string {
  return `Goal reminder from the Board (keep going with your current work):\n${block}`
}

export class GoalReminderEngine {
  private readonly tracks = new Map<string, ConsoleReminderTrack>()
  private readonly inFlight = new Set<string>()

  constructor(private readonly deps: GoalReminderDeps) {}

  /** Re-reads wiring and status: counts finished turns and sends whatever is due. */
  sweep(): void {
    const wiring = goalWiringByTab(this.deps.boards())
    for (const tabId of this.tracks.keys()) {
      if (!wiring.has(tabId)) {
        this.tracks.delete(tabId)
      }
    }
    for (const w of wiring.values()) {
      const entry = this.deps.statusOf(w.tabId)
      const known = this.tracks.get(w.tabId)
      if (!known) {
        this.tracks.set(w.tabId, baselineTrack(entry))
      } else {
        const policy = mergeReminderPolicies(w.goals.map((g) => g.reminders))
        const { track, completed } = observeTurn(known, entry, policy)
        this.tracks.set(w.tabId, track)
        if (completed && entry) {
          this.deps.onTurnCompleted?.(w, entry)
        }
      }
      this.deliverIfDue(w)
    }
  }

  /** Compaction signal for one console (see goal-reminders.ts for where it comes from). */
  noteCompaction(tabId: string): void {
    const w = goalWiringByTab(this.deps.boards()).get(tabId)
    if (!w) {
      return
    }
    const policy = mergeReminderPolicies(w.goals.map((g) => g.reminders))
    this.tracks.set(tabId, noteCompaction(this.track(tabId), policy))
    this.deliverIfDue(w)
  }

  /** "Remind now": arms every console the goal reaches, then sends where allowed. */
  remindNow(worktreeId: string, goalCardId: string): RemindNowSummary {
    const board = this.deps.boards()[worktreeId]
    const goal = board?.cards.find((c) => c.id === goalCardId)
    const summary: RemindNowSummary = { queued: 0, waiting: 0, noAgent: 0 }
    if (!board || goal?.kind !== 'goal') {
      return summary
    }
    const wiring = goalWiringByTab(this.deps.boards())
    for (const c of goalTargetConsoles(board, goal.wiredCardIds)) {
      const w = wiring.get(c.tabId)
      if (!w) {
        continue
      }
      this.tracks.set(c.tabId, requestManualReminder(this.track(c.tabId)))
      const outcome = this.deliverIfDue(w)
      summary[outcome === 'send' ? 'queued' : outcome === 'drop' ? 'noAgent' : 'waiting'] += 1
    }
    return summary
  }

  /**
   * Goal block to put in front of a new task for this console, or null. A task
   * that carries the goal counts as the console's reminder (and its throttle).
   */
  taskPrefix(tabId: string): string | null {
    const w = goalWiringByTab(this.deps.boards()).get(tabId)
    const block = w ? formatGoalBlock(w.goals) : null
    if (!w || !block) {
      return null
    }
    const policy = mergeReminderPolicies(w.goals.map((g) => g.reminders))
    const now = this.deps.now()
    if (!taskCarriesGoal(this.track(tabId), policy, now)) {
      return null
    }
    this.tracks.set(tabId, markReminded(this.track(tabId), now))
    return `${block}\n\n`
  }

  trackFor(tabId: string): ConsoleReminderTrack | undefined {
    return this.tracks.get(tabId)
  }

  isThrottled(tabId: string): boolean {
    return throttled(this.track(tabId), this.deps.now())
  }

  private track(tabId: string): ConsoleReminderTrack {
    return this.tracks.get(tabId) ?? baselineTrack(this.deps.statusOf(tabId))
  }

  private deliverIfDue(w: ConsoleGoalWiring): 'send' | 'wait' | 'drop' | 'none' {
    const { tabId } = w
    if (this.inFlight.has(tabId)) {
      return 'wait'
    }
    const track = this.track(tabId)
    const gate = reminderGate(track, {
      now: this.deps.now(),
      state: this.deps.stateOf(tabId),
      hasAgent: this.deps.statusOf(tabId) !== null
    })
    const block = gate === 'send' ? formatGoalBlock(w.goals) : null
    if (gate === 'drop' || (gate === 'send' && !block)) {
      this.tracks.set(tabId, disarm(track))
      return 'drop'
    }
    if (gate !== 'send' || !block) {
      return gate
    }
    this.inFlight.add(tabId)
    void this.deps
      .enqueue(tabId, goalReminderText(block))
      .catch((error: unknown): DeliveryOutcome => ({ kind: 'failed', reason: String(error) }))
      .then((outcome) => {
        this.inFlight.delete(tabId)
        const current = this.tracks.get(tabId) ?? EMPTY_REMINDER_TRACK
        const now = this.deps.now()
        if (outcome.kind === 'sent') {
          this.tracks.set(tabId, markReminded(current, now))
        } else if (
          outcome.kind === 'skipped' &&
          (outcome.reason === 'shell' || outcome.reason === 'gone')
        ) {
          this.tracks.set(tabId, disarm(current))
        } else {
          // Why: back off one throttle window before retrying a failed or held reminder.
          this.tracks.set(tabId, { ...current, lastRemindedAt: now })
        }
      })
    return 'send'
  }
}
