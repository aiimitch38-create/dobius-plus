/**
 * Leak regression: Board state is per worktree and main reads Board groups from
 * it, so removing a worktree must drop its board (and the removal must be saved),
 * while a rename must keep it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type * as AgentStatusModule from '@/lib/agent-status'

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() }
}))
vi.mock('@/components/terminal-pane/pty-dispatcher', () => ({
  restorePtyDataHandlersAfterFailedShutdown: vi.fn(),
  unregisterPtyDataHandlers: vi.fn()
}))
vi.mock('@/lib/agent-status', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentStatusModule>()
  return { ...actual, detectAgentStatusFromTitle: vi.fn().mockReturnValue(null) }
})

const mockApi = {
  worktrees: {
    list: vi.fn().mockResolvedValue([]),
    remove: vi.fn().mockResolvedValue(undefined),
    forceDeletePreservedBranch: vi.fn().mockResolvedValue({ deleted: true }),
    updateMeta: vi.fn().mockResolvedValue({})
  },
  pty: { kill: vi.fn().mockResolvedValue(undefined) },
  runtimeEnvironments: { call: vi.fn().mockResolvedValue({ ok: true, result: {} }) },
  ui: { set: vi.fn().mockResolvedValue(undefined) }
}
// @ts-expect-error -- minimal window.api stub for the store under test
globalThis.window = { api: mockApi }

import { createTestStore, seedStore, makeWorktree } from './store-test-helpers'
import { resetBoardPersistenceForTest } from './board'

const WT1 = 'repo1::/path/wt1'
const WT2 = 'repo1::/path/wt2'
const board = (x: number) => ({
  cards: [],
  groups: [],
  viewport: { x, y: 0, zoom: 1 },
  tool: 'select'
})

function seed(store: ReturnType<typeof createTestStore>): void {
  seedStore(store, {
    worktreesByRepo: {
      repo1: [
        makeWorktree({ id: WT1, repoId: 'repo1', path: '/path/wt1' }),
        makeWorktree({ id: WT2, repoId: 'repo1', path: '/path/wt2' })
      ]
    }
  })
  store.getState().hydrateBoards({ [WT1]: board(1), [WT2]: board(2) })
}

const lastSavedKeys = (): string[] => {
  const calls = mockApi.ui.set.mock.calls as unknown as [
    { boardsByWorktree: Record<string, unknown> }
  ][]
  return Object.keys(calls.at(-1)?.[0].boardsByWorktree ?? {})
}

describe('worktree removal drops its Board', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    resetBoardPersistenceForTest()
  })
  afterEach(() => vi.useRealTimers())

  it('bulk purge drops the removed board, keeps the other, and saves', () => {
    const store = createTestStore()
    seed(store)
    store.getState().purgeWorktreeTerminalState([WT1])
    expect(store.getState().boardsByWorktree[WT1]).toBeUndefined()
    expect(store.getState().boardsByWorktree[WT2]).toBeDefined()
    vi.runAllTimers()
    expect(lastSavedKeys()).toEqual([WT2])
  })

  it('single removeWorktree drops the removed board and saves', async () => {
    const store = createTestStore()
    seed(store)
    await vi.runAllTimersAsync()
    mockApi.ui.set.mockClear()
    const result = await store.getState().removeWorktree(WT1)
    expect(result).toEqual({ ok: true })
    expect(store.getState().boardsByWorktree[WT1]).toBeUndefined()
    await vi.runAllTimersAsync()
    expect(lastSavedKeys()).toEqual([WT2])
  })
})
