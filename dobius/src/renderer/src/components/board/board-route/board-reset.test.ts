import { create } from 'zustand'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '@/store/types'
import {
  createBoardSlice,
  getBoard,
  resetBoardPersistenceForTest,
  type BoardCard,
  type NewBoardCard
} from '@/store/slices/board'
import { boardResetPlan, resetBoard } from './board-reset'

const { testStore, closeTerminalTab } = vi.hoisted(() => ({
  testStore: { current: null as unknown },
  closeTerminalTab: vi.fn()
}))
vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => (testStore.current as { getState: () => AppState }).getState(),
    subscribe: (...args: unknown[]) =>
      (testStore.current as { subscribe: (...a: unknown[]) => unknown }).subscribe(...args)
  }
}))
vi.mock('@/components/terminal/terminal-tab-actions', () => ({ closeTerminalTab }))

// @ts-expect-error -- test shim
globalThis.window = { api: { ui: { set: vi.fn(() => Promise.resolve()) } } }

const base = { x: 0, y: 0, w: 100, h: 100, z: 1, title: 't' }
const WT = 'wt-1'

describe('boardResetPlan', () => {
  it('closes consoles by tab and removes every other card outright', () => {
    const cards = [
      { ...base, id: 'c1', kind: 'console', tabId: 'tab-1', agentKind: 'claude' },
      { ...base, id: 'w1', kind: 'web', url: 'https://example.com' },
      { ...base, id: 'n1', kind: 'note', text: 'hi', color: 'yellow' },
      { ...base, id: 'c2', kind: 'console', tabId: 'tab-2', agentKind: 'codex' }
    ] as unknown as BoardCard[]
    expect(boardResetPlan(cards)).toEqual({
      consoles: [
        { cardId: 'c1', tabId: 'tab-1' },
        { cardId: 'c2', tabId: 'tab-2' }
      ],
      otherCardIds: ['w1', 'n1']
    })
  })

  it('is empty for an empty board', () => {
    expect(boardResetPlan([])).toEqual({ consoles: [], otherCardIds: [] })
  })
})

function createTestStore() {
  return create<AppState>()(
    (...a) =>
      ({
        ...createBoardSlice(...a),
        activeWorktreeId: null,
        tabsByWorktree: {},
        setActiveWorktree: (id: string | null) => a[0]({ activeWorktreeId: id })
      }) as unknown as AppState
  )
}

describe('resetBoard', () => {
  let store: ReturnType<typeof createTestStore>
  beforeEach(() => {
    resetBoardPersistenceForTest()
    closeTerminalTab.mockReset()
    store = createTestStore()
    testStore.current = store
  })

  it('keeps the workspace active after Reset closes its last terminal', () => {
    store.getState().setActiveWorktree(WT)
    store.getState().addCard(WT, {
      ...base,
      kind: 'console',
      tabId: 'tab-1',
      agentKind: 'claude'
    } as unknown as NewBoardCard)
    store.getState().addCard(WT, {
      ...base,
      kind: 'note',
      text: '',
      color: 'yellow'
    } as unknown as NewBoardCard)
    // Mirrors closeTerminalTab: closing the last terminal deactivates the workspace.
    closeTerminalTab.mockImplementation((tabId: string) => {
      if (tabId === 'tab-1') {
        store.setState({ activeWorktreeId: null })
      }
    })

    resetBoard(WT)

    expect(closeTerminalTab).toHaveBeenCalledWith('tab-1')
    expect(getBoard(store.getState(), WT).cards).toEqual([])
    expect(store.getState().activeWorktreeId).toBe(WT)
  })
})
