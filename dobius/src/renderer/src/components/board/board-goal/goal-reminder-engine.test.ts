import { describe, expect, it, vi } from 'vitest'
import type { BoardState } from '@/store/slices/board'
import type { AgentStatusEntry } from '../../../../../shared/agent-status-types'
import type { ConsoleDeliveryState, DeliveryOutcome } from '../board-delivery/delivery-gate'
import { GoalReminderEngine, goalReminderText } from './goal-reminder-engine'
import { GOAL_REMINDER_THROTTLE_MS } from './goal-reminder-logic'
import { boardOf, consoleCard, goalCard } from './goal-test-fixtures'

const WT = 'wt'
const TAB = 'tab-a'

function harness(goalOver: Parameters<typeof goalCard>[1] = {}) {
  let now = 1_000_000
  let entry: AgentStatusEntry | null = null
  let state: ConsoleDeliveryState = 'idle'
  let outcome: DeliveryOutcome = { kind: 'sent', busy: false }
  const boards: Record<string, BoardState> = {
    [WT]: boardOf([
      consoleCard('a', 'Claude 1'),
      goalCard('g', { wiredCardIds: ['a'], ...goalOver })
    ])
  }
  const enqueue = vi.fn(async (_tabId: string, _text: string) => outcome)
  const onTurnCompleted = vi.fn()
  const engine = new GoalReminderEngine({
    boards: () => boards,
    statusOf: () => entry,
    stateOf: () => state,
    enqueue,
    now: () => now,
    onTurnCompleted
  })
  return {
    engine,
    enqueue,
    onTurnCompleted,
    boards,
    advance: (ms: number) => {
      now += ms
    },
    setState: (s: ConsoleDeliveryState) => {
      state = s
    },
    setOutcome: (o: DeliveryOutcome) => {
      outcome = o
    },
    /** One finished turn: the agent reports a new "done" episode. */
    finishTurn: (report = 'did work') => {
      now += 1_000
      entry = {
        state: 'done',
        stateStartedAt: now,
        updatedAt: now,
        lastAssistantMessage: report
      } as AgentStatusEntry
      engine.sweep()
    },
    settle: () => new Promise((resolve) => setTimeout(resolve, 0))
  }
}

describe('GoalReminderEngine', () => {
  it('reminds after every 5 finished turns through the delivery gate', async () => {
    const h = harness()
    h.finishTurn() // first sight is the baseline, never counted
    for (let i = 0; i < 4; i += 1) {
      h.finishTurn()
    }
    expect(h.enqueue).not.toHaveBeenCalled()
    h.finishTurn()
    expect(h.enqueue).toHaveBeenCalledTimes(1)
    expect(h.enqueue).toHaveBeenCalledWith(TAB, goalReminderText('Main goal: Ship the login page.'))
    await h.settle()
    expect(h.engine.trackFor(TAB)?.turns).toBe(0)
    expect(h.onTurnCompleted).toHaveBeenCalledTimes(5)
  })

  it('respects a custom cadence and an off switch', () => {
    const h = harness({ reminders: { afterCompaction: false, everyTurns: 0, onNewTask: false } })
    h.finishTurn()
    for (let i = 0; i < 12; i += 1) {
      h.finishTurn()
    }
    expect(h.enqueue).not.toHaveBeenCalled()
  })

  it('waits while the console is busy or on a dialog, then sends when it is idle', () => {
    const h = harness({ reminders: { afterCompaction: true, everyTurns: 1, onNewTask: true } })
    h.finishTurn()
    h.setState('working')
    h.finishTurn()
    expect(h.enqueue).not.toHaveBeenCalled()
    h.setState('waiting')
    h.engine.sweep()
    expect(h.enqueue).not.toHaveBeenCalled()
    h.setState('done')
    h.engine.sweep()
    expect(h.enqueue).toHaveBeenCalledTimes(1)
  })

  it('never reminds the same console twice within the throttle window', async () => {
    const h = harness({ reminders: { afterCompaction: true, everyTurns: 1, onNewTask: true } })
    h.finishTurn()
    h.finishTurn()
    await h.settle()
    expect(h.enqueue).toHaveBeenCalledTimes(1)
    h.finishTurn()
    h.finishTurn()
    expect(h.enqueue).toHaveBeenCalledTimes(1)
    h.advance(GOAL_REMINDER_THROTTLE_MS)
    h.engine.sweep()
    expect(h.enqueue).toHaveBeenCalledTimes(2)
  })

  it('skips consoles with no agent and drops the reminder when the gate finds a bare shell', async () => {
    const h = harness()
    expect(h.engine.remindNow(WT, 'g')).toEqual({ queued: 0, waiting: 0, noAgent: 1 })
    expect(h.enqueue).not.toHaveBeenCalled()

    h.finishTurn()
    h.setOutcome({ kind: 'skipped', reason: 'shell' })
    expect(h.engine.remindNow(WT, 'g')).toEqual({ queued: 1, waiting: 0, noAgent: 0 })
    await h.settle()
    expect(h.engine.trackFor(TAB)?.pending).toBeNull()
    expect(h.engine.trackFor(TAB)?.lastRemindedAt).toBeNull()
  })

  it('arms a reminder on compaction only when that trigger is on', () => {
    const off = harness({ reminders: { afterCompaction: false, everyTurns: 5, onNewTask: true } })
    off.finishTurn()
    off.engine.noteCompaction(TAB)
    expect(off.enqueue).not.toHaveBeenCalled()

    const on = harness()
    on.finishTurn()
    on.setState('working')
    on.engine.noteCompaction(TAB)
    expect(on.enqueue).not.toHaveBeenCalled()
    expect(on.engine.trackFor(TAB)?.pending).toBe('compaction')
    on.setState('idle')
    on.engine.sweep()
    expect(on.enqueue).toHaveBeenCalledTimes(1)
  })

  it('puts the goal in front of a new task, throttled, and counts it as the reminder', () => {
    const h = harness()
    h.finishTurn()
    expect(h.engine.taskPrefix(TAB)).toBe('Main goal: Ship the login page.\n\n')
    expect(h.engine.taskPrefix(TAB)).toBeNull()
    expect(h.engine.remindNow(WT, 'g')).toEqual({ queued: 0, waiting: 1, noAgent: 0 })
    h.advance(GOAL_REMINDER_THROTTLE_MS)
    expect(h.engine.taskPrefix(TAB)).not.toBeNull()
    expect(h.engine.taskPrefix('tab-unwired')).toBeNull()
  })

  it('leaves new tasks alone when the on-new-task trigger is off', () => {
    const h = harness({ reminders: { afterCompaction: true, everyTurns: 5, onNewTask: false } })
    expect(h.engine.taskPrefix(TAB)).toBeNull()
  })

  it('backs off one window after a failed delivery instead of retrying at once', async () => {
    const h = harness({ reminders: { afterCompaction: true, everyTurns: 1, onNewTask: true } })
    h.setOutcome({ kind: 'failed', reason: 'boom' })
    h.finishTurn()
    h.finishTurn()
    await h.settle()
    expect(h.enqueue).toHaveBeenCalledTimes(1)
    expect(h.engine.trackFor(TAB)?.pending).toBe('turns')
    h.engine.sweep()
    expect(h.enqueue).toHaveBeenCalledTimes(1)
    h.setOutcome({ kind: 'sent', busy: false })
    h.advance(GOAL_REMINDER_THROTTLE_MS)
    h.engine.sweep()
    expect(h.enqueue).toHaveBeenCalledTimes(2)
  })

  it('forgets consoles that are no longer wired', () => {
    const h = harness()
    h.finishTurn()
    expect(h.engine.trackFor(TAB)).toBeDefined()
    const board = h.boards[WT]
    h.boards[WT] = { ...board, cards: board.cards.filter((c) => c.kind !== 'goal') }
    h.engine.sweep()
    expect(h.engine.trackFor(TAB)).toBeUndefined()
  })
})
