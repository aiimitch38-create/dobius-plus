import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NewBoardCard } from '@/store/slices/board'

// Why a second file: these run Reset against the full app store, so the real
// closeTab and closeUnifiedTab decide whether the workspace stays selected.
const { testStore } = vi.hoisted(() => ({ testStore: { current: null as unknown } }))
vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => (testStore.current as { getState: () => unknown }).getState(),
    subscribe: (...args: unknown[]) =>
      (testStore.current as { subscribe: (...a: unknown[]) => unknown }).subscribe(...args)
  }
}))
vi.mock('sonner', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() }
}))
vi.mock('@/components/terminal-pane/pty-dispatcher', () => ({
  restorePtyDataHandlersAfterFailedShutdown: vi.fn(),
  unregisterPtyDataHandlers: vi.fn()
}))

// @ts-expect-error -- test shim
globalThis.window = { api: { ui: { set: vi.fn(() => Promise.resolve()) } } }

import { getBoard, resetBoardPersistenceForTest } from '@/store/slices/board'
import {
  createTestStore,
  makeTab,
  makeTabGroup,
  makeUnifiedTab,
  makeWorktree,
  seedStore
} from '@/store/slices/store-test-helpers'
import { closeConsoleCards, resetBoard } from './board-reset'

const WT = 'repo1::/path/wt1'
const GROUP = 'group-1'

describe('closing board consoles against the real store', () => {
  let store: ReturnType<typeof createTestStore>
  beforeEach(() => {
    resetBoardPersistenceForTest()
    store = createTestStore()
    testStore.current = store
  })

  /** An active workspace on the board with one console (terminal + unified tab) per id. */
  function seedBoard(tabIds: string[], pinned: string[] = []): void {
    seedStore(store, {
      worktreesByRepo: { repo1: [makeWorktree({ id: WT, repoId: 'repo1', path: '/path/wt1' })] },
      activeWorktreeId: WT,
      activeView: 'board',
      activeTabId: tabIds[0],
      activeTabType: 'terminal',
      activeTabIdByWorktree: { [WT]: tabIds[0] },
      activeTabTypeByWorktree: { [WT]: 'terminal' },
      tabsByWorktree: { [WT]: tabIds.map((id) => makeTab({ id, worktreeId: WT })) },
      unifiedTabsByWorktree: {
        [WT]: tabIds.map((id) =>
          makeUnifiedTab({
            id: `u-${id}`,
            entityId: id,
            worktreeId: WT,
            groupId: GROUP,
            contentType: 'terminal',
            label: id,
            isPinned: pinned.includes(id)
          })
        )
      },
      groupsByWorktree: {
        [WT]: [
          makeTabGroup({
            id: GROUP,
            worktreeId: WT,
            activeTabId: `u-${tabIds[0]}`,
            tabOrder: tabIds.map((id) => `u-${id}`)
          })
        ]
      },
      activeGroupIdByWorktree: { [WT]: GROUP },
      layoutByWorktree: { [WT]: { type: 'leaf', groupId: GROUP } }
    })
    for (const tabId of tabIds) {
      store.getState().addCard(WT, {
        x: 0,
        y: 0,
        w: 100,
        h: 100,
        z: 1,
        title: tabId,
        kind: 'console',
        tabId,
        agentKind: 'claude'
      } as unknown as NewBoardCard)
    }
  }

  const onTheBoard = (): boolean =>
    store.getState().activeWorktreeId === WT && store.getState().activeView === 'board'
  const consoleTargets = (): { cardId: string; tabId: string }[] =>
    getBoard(store.getState(), WT).cards.flatMap((card) =>
      card.kind === 'console' ? [{ cardId: card.id, tabId: card.tabId }] : []
    )

  it('a plain close of the only terminal does deactivate the workspace', () => {
    seedBoard(['tab-1'])

    store.getState().closeTab('tab-1')

    expect(store.getState().activeWorktreeId).toBeNull()
  })

  it('Reset of the only console stays on the board', () => {
    seedBoard(['tab-1'])

    resetBoard(WT)

    expect(store.getState().tabsByWorktree[WT]).toEqual([])
    expect(store.getState().unifiedTabsByWorktree[WT]).toEqual([])
    expect(getBoard(store.getState(), WT).cards).toEqual([])
    expect(onTheBoard()).toBe(true)
  })

  it('Close all consoles stays on the board when they were the last tabs', () => {
    seedBoard(['tab-1', 'tab-2'])

    closeConsoleCards(WT, consoleTargets())

    expect(store.getState().tabsByWorktree[WT]).toEqual([])
    expect(getBoard(store.getState(), WT).cards).toEqual([])
    expect(onTheBoard()).toBe(true)
  })
})
