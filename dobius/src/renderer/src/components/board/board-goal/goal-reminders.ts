// App-wide goal reminder engine wired to the store and the Board delivery gate.
//
// Compaction trigger gap: Dobius's managed agent hooks do not subscribe Claude
// Code's PreCompact event (main/claude/hook-settings.ts CLAUDE_EVENTS) or
// Codex's PreCompact/PostCompact (main/codex/hook-service.ts CODEX_EVENTS), and
// the status feed carries no compaction field, so the renderer never learns
// that an agent compacted. Screen scraping the TUI's "compacted" line is not
// reliable (only mounted cards have a readable screen, and agent output can
// contain the same words), so it is not attempted. noteGoalCompaction() is the
// hook point for when a real signal is added.
import { useAppStore } from '@/store'
import {
  boardDeliveryGate,
  consoleDeliveryState,
  type OrderLaneInput
} from '../board-delivery/board-delivery'
import { latestEntryForTab } from '../board-delivery/mission-state'
import { runGoalDriftCheck } from './goal-drift'
import { GoalReminderEngine, type RemindNowSummary } from './goal-reminder-engine'

const SWEEP_EVERY_MS = 15_000

let engine: GoalReminderEngine | null = null

function goalEngine(): GoalReminderEngine {
  engine ??= new GoalReminderEngine({
    boards: () => useAppStore.getState().boardsByWorktree ?? {},
    statusOf: (tabId) => latestEntryForTab(useAppStore.getState().agentStatusByPaneKey, tabId),
    stateOf: (tabId) => consoleDeliveryState(tabId),
    // Why: a reminder is not an order, so it skips the order log and mission tracking but
    // still goes through the one gate (one typist, dialog hold, no bare shells).
    enqueue: (tabId, text) =>
      boardDeliveryGate().enqueue({ orderId: `goal-reminder:${crypto.randomUUID()}`, tabId, text }),
    now: () => Date.now(),
    onTurnCompleted: (wiring, entry) => {
      for (const goal of wiring.goals) {
        void runGoalDriftCheck({
          goal,
          tabId: wiring.tabId,
          consoleName: wiring.consoleName,
          report: entry.lastAssistantMessage ?? '',
          now: Date.now()
        })
      }
    }
  })
  return engine
}

let started = false

/** Starts watching the status feed once per window (idempotent, never stops, like missions). */
export function ensureGoalReminders(): void {
  if (started) {
    return
  }
  started = true
  const e = goalEngine()
  e.sweep()
  useAppStore.subscribe((s, prev) => {
    if (s.agentStatusByPaneKey !== prev.agentStatusByPaneKey) {
      e.sweep()
    }
  })
  setInterval(() => e.sweep(), SWEEP_EVERY_MS)
}

export function remindGoalNow(worktreeId: string, goalCardId: string): RemindNowSummary {
  return goalEngine().remindNow(worktreeId, goalCardId)
}

export function noteGoalCompaction(tabId: string): void {
  goalEngine().noteCompaction(tabId)
}

/** Goal block for a new task to this console tab, or null (trigger off, throttled, unwired). */
export function goalTaskPrefix(tabId: string): string | null {
  return goalEngine().taskPrefix(tabId)
}

/** Delivery lanes with the goal block in front of each wired console's task. */
export function withGoalPrefix<L extends OrderLaneInput>(lanes: readonly L[]): L[] {
  return lanes.map((lane) => {
    const prefix = goalTaskPrefix(lane.tabId)
    return prefix ? { ...lane, prefix } : lane
  })
}
