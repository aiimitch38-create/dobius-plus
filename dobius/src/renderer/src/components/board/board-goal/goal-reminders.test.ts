import { afterEach, describe, expect, it, vi } from 'vitest'
import { makePaneKey } from '../../../../../shared/stable-pane-id'
import { boardOf, consoleCard, goalCard } from './goal-test-fixtures'

const LEAF = '11111111-1111-4111-8111-111111111111'

const enqueue = vi.fn(async (_order: { tabId: string; text: string }) => ({
  kind: 'sent' as const,
  busy: false
}))

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      boardsByWorktree: {
        wt: boardOf([consoleCard('a'), goalCard('g', { wiredCardIds: ['a'] })])
      },
      agentStatusByPaneKey: {}
    }),
    subscribe: vi.fn()
  }
}))

vi.mock('../board-delivery/board-delivery', () => ({
  boardDeliveryGate: () => ({ enqueue }),
  consoleDeliveryState: () => 'idle'
}))

vi.mock('../board-delivery/mission-state', () => ({
  latestEntryForTab: () => ({ state: 'done', stateStartedAt: 1, updatedAt: 1 })
}))

vi.mock('./goal-drift', () => ({ runGoalDriftCheck: vi.fn() }))

describe('goal reminders compaction wiring', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('sends the goal reminder when the agent status feed reports a compaction', async () => {
    vi.useFakeTimers()
    let onCompaction: ((data: { paneKey: string }) => void) | null = null
    vi.stubGlobal('window', {
      api: {
        agentStatus: {
          onCompaction: (cb: (data: { paneKey: string }) => void) => {
            onCompaction = cb
            return () => {}
          }
        }
      }
    })
    vi.stubGlobal('crypto', { randomUUID: () => 'uuid' })
    const { ensureGoalReminders } = await import('./goal-reminders')

    ensureGoalReminders()
    expect(onCompaction).not.toBeNull()
    expect(enqueue).not.toHaveBeenCalled()

    onCompaction!({ paneKey: makePaneKey('tab-a', LEAF) })

    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue.mock.calls[0]?.[0]).toMatchObject({ tabId: 'tab-a' })
    expect(enqueue.mock.calls[0]?.[0].text).toContain('Goal reminder from the Board')
  })

  it('ignores a malformed pane key', async () => {
    const { noteGoalCompactionForPane } = await import('./goal-reminders')
    enqueue.mockClear()
    noteGoalCompactionForPane('not-a-pane-key')
    expect(enqueue).not.toHaveBeenCalled()
  })
})
