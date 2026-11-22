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
import { boardResetPlan, closeConsoleCards, resetBoard } from './board-reset'

const { testStore } = vi.hoisted(() => ({ testStore: { current: null as unknown } }))
vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => (testStore.current as { getState: () => AppState }).getState(),
    subscribe: (...args: unknown[]) =>
      (testStore.current as { subscribe: (...a: unknown[]) => unknown }).subscribe(...args)
  }
}))
// Why: the real closeTerminalTab runs here (its last-terminal fallback and pin
// guard are what Reset must get right); only the paired-web runtime is stubbed.
vi.mock('@/runtime/web-runtime-session', () => ({
  activateWebRuntimeSessionTab: vi.fn(),
  closeWebRuntimeSessionTab: vi.fn(),
  createWebRuntimeSessionTerminal: vi.fn(),
  isWebRuntimeSessionActive: () => false,
  toHostSessionTabId: (tabId: string) => tabId
}))
vi.mock('@/runtime/web-session-tabs-sync', () => ({
  resolveHostSessionTabIdForWebSessionTab: () => null
}))

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

type PinConfirm = { tabLabel: string; onConfirm: () => void }
type TestState = AppState & { pinConfirm: PinConfirm | null }

function createTestStore() {
  return create<TestState>()(
    (...a) =>
      ({
        ...createBoardSlice(...(a as unknown as Parameters<typeof createBoardSlice>)),
        activeWorktreeId: null,
        activeView: 'board',
        activeTabId: null,
        activeTabType: 'terminal',
        activeFileId: null,
        activeBrowserTabId: null,
        tabsByWorktree: {},
        unifiedTabsByWorktree: {},
        openFiles: [],
        browserTabsByWorktree: {},
        settings: null,
        pinConfirm: null,
        setActiveWorktree: (id: string | null) => a[0]({ activeWorktreeId: id }),
        setActiveTab: (id: string) => a[0]({ activeTabId: id }),
        setActiveTabType: (type: AppState['activeTabType']) => a[0]({ activeTabType: type }),
        setActiveFile: (id: string) => a[0]({ activeFileId: id }),
        setActiveBrowserTab: (id: string) => a[0]({ activeBrowserTabId: id }),
        closeTab: (tabId: string) =>
          a[0]((s) => ({
            tabsByWorktree: Object.fromEntries(
              Object.entries(s.tabsByWorktree).map(([wt, tabs]) => [
                wt,
                tabs.filter((tab) => tab.id !== tabId)
              ])
            )
          })),
        requestPinnedTabCloseConfirm: (request: PinConfirm) => a[0]({ pinConfirm: request })
      }) as unknown as TestState
  )
}

describe('resetBoard', () => {
  let store: ReturnType<typeof createTestStore>
  beforeEach(() => {
    resetBoardPersistenceForTest()
    store = createTestStore()
    testStore.current = store
  })

  /** An active workspace whose board has one console per tab id, plus a note. */
  function seedBoard(tabIds: string[]): void {
    store.setState({
      activeWorktreeId: WT,
      activeTabId: tabIds[0],
      tabsByWorktree: { [WT]: tabIds.map((id) => ({ id })) }
    } as unknown as Partial<TestState>)
    for (const tabId of tabIds) {
      store.getState().addCard(WT, {
        ...base,
        kind: 'console',
        tabId,
        agentKind: 'claude'
      } as unknown as NewBoardCard)
    }
    store.getState().addCard(WT, {
      ...base,
      kind: 'note',
      text: '',
      color: 'yellow'
    } as unknown as NewBoardCard)
  }

  const onTheBoard = (): boolean =>
    store.getState().activeWorktreeId === WT && store.getState().activeView === 'board'

  it('keeps the workspace active after Reset closes its last terminal', () => {
    seedBoard(['tab-1', 'tab-2'])

    resetBoard(WT)

    expect(store.getState().tabsByWorktree[WT]).toEqual([])
    expect(getBoard(store.getState(), WT).cards).toEqual([])
    expect(onTheBoard()).toBe(true)
  })

  it('stays on the board instead of switching to an open file', () => {
    seedBoard(['tab-1'])
    store.setState({
      openFiles: [{ id: 'file-1', worktreeId: WT }]
    } as unknown as Partial<TestState>)

    resetBoard(WT)

    expect(getBoard(store.getState(), WT).cards).toEqual([])
    expect(onTheBoard()).toBe(true)
    expect(store.getState().activeTabType).toBe('terminal')
    expect(store.getState().activeFileId).toBeNull()
  })

  it('stays on the board instead of switching to an open browser tab', () => {
    seedBoard(['tab-1'])
    store.setState({
      browserTabsByWorktree: { [WT]: [{ id: 'browser-1' }] }
    } as unknown as Partial<TestState>)

    resetBoard(WT)

    expect(getBoard(store.getState(), WT).cards).toEqual([])
    expect(onTheBoard()).toBe(true)
    expect(store.getState().activeTabType).toBe('terminal')
    expect(store.getState().activeBrowserTabId).toBeNull()
  })

  it('never closes a pinned console without its confirmation, and stays on the board after it', () => {
    seedBoard(['tab-1', 'tab-pinned'])
    store.setState({
      unifiedTabsByWorktree: {
        [WT]: [{ id: 'u-pinned', entityId: 'tab-pinned', contentType: 'terminal', isPinned: true }]
      }
    } as unknown as Partial<TestState>)
    const consoleTabIds = (): string[] =>
      getBoard(store.getState(), WT).cards.flatMap((c) => (c.kind === 'console' ? [c.tabId] : []))

    resetBoard(WT)

    // The unpinned console and the note are gone; the pinned one waits for its answer.
    expect(store.getState().pinConfirm).not.toBeNull()
    expect(store.getState().tabsByWorktree[WT]).toEqual([{ id: 'tab-pinned' }])
    expect(consoleTabIds()).toEqual(['tab-pinned'])
    expect(getBoard(store.getState(), WT).cards).toHaveLength(1)
    expect(onTheBoard()).toBe(true)

    // The user confirms later: now it is the workspace's last terminal.
    store.getState().pinConfirm?.onConfirm()

    expect(store.getState().tabsByWorktree[WT]).toEqual([])
    expect(getBoard(store.getState(), WT).cards).toEqual([])
    expect(onTheBoard()).toBe(true)
  })

  // "Close all consoles" calls this directly: the other cards stay, and so does the user.
  it('closing every console keeps the other cards and stays on the board', () => {
    seedBoard(['tab-1', 'tab-2'])
    store.setState({
      openFiles: [{ id: 'file-1', worktreeId: WT }]
    } as unknown as Partial<TestState>)

    closeConsoleCards(WT, boardResetPlan(getBoard(store.getState(), WT).cards).consoles)

    expect(store.getState().tabsByWorktree[WT]).toEqual([])
    expect(getBoard(store.getState(), WT).cards.map((c) => c.kind)).toEqual(['note'])
    expect(onTheBoard()).toBe(true)
    expect(store.getState().activeTabType).toBe('terminal')
    expect(store.getState().activeFileId).toBeNull()
  })
})
