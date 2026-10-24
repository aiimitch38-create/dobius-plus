import { create } from 'zustand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '@/store/types'
import {
  createBoardSlice,
  getBoard,
  resetBoardPersistenceForTest,
  type NewBoardCard
} from '@/store/slices/board'

const { testStore, toastMock } = vi.hoisted(() => ({
  testStore: { current: null as unknown },
  toastMock: vi.fn()
}))
vi.mock('@/store', () => ({
  useAppStore: { getState: () => (testStore.current as { getState: () => AppState }).getState() }
}))
vi.mock('sonner', () => ({ toast: toastMock }))

import { boardRemovalOf, deletedToastMessage, removeCardsWithUndo } from './board-history-delete'

// @ts-expect-error -- test shim
globalThis.window = { api: { ui: { set: vi.fn(() => Promise.resolve()) } } }

const WT = 'wt-1'
const note = (title: string): NewBoardCard =>
  ({ kind: 'note', text: '', color: 'yellow', x: 0, y: 0, w: 200, h: 150, title }) as NewBoardCard

function createTestStore() {
  return create<AppState>()((...a) => ({ ...createBoardSlice(...a) }) as AppState)
}

describe('removeCardsWithUndo', () => {
  let store: ReturnType<typeof createTestStore>
  beforeEach(() => {
    vi.useFakeTimers()
    resetBoardPersistenceForTest()
    store = createTestStore()
    testStore.current = store
    toastMock.mockReset()
  })
  afterEach(() => vi.useRealTimers())

  it('deletes, shows an Undo toast, and Undo puts back exactly that card with its links', () => {
    const s = store.getState()
    const a = s.addCard(WT, note('A'))
    const b = s.addCard(WT, note('B'))
    const g = s.createGroup(WT, { name: 'G', cardIds: [a, b] })
    s.addConnector(WT, { fromCardId: a, toCardId: b })

    removeCardsWithUndo(WT, [a])
    expect(getBoard(store.getState(), WT).cards.map((c) => c.id)).toEqual([b])
    expect(toastMock).toHaveBeenCalledTimes(1)
    const [message, options] = toastMock.mock.calls[0]
    expect(message).toBe('Deleted A')

    // An edit after the delete must survive the undo.
    store.getState().updateCard(WT, b, { title: 'B2' })
    options.action.onClick()
    const board = getBoard(store.getState(), WT)
    expect(board.cards.map((c) => c.id).sort()).toEqual([a, b].sort())
    expect(board.cards.find((c) => c.id === b)?.title).toBe('B2')
    expect(board.groups.find((x) => x.id === g)?.cardIds.sort()).toEqual([a, b].sort())
    expect(board.connectors).toHaveLength(1)

    // A second click is a no-op.
    options.action.onClick()
    expect(getBoard(store.getState(), WT).cards).toHaveLength(2)
  })

  it('does nothing for ids that are not on the board', () => {
    removeCardsWithUndo(WT, ['missing'])
    expect(toastMock).not.toHaveBeenCalled()
  })
})

describe('boardRemovalOf / deletedToastMessage', () => {
  it('captures orchestrator wiring that the delete would drop', () => {
    const before = {
      cards: [
        { id: 'o', kind: 'orchestrator', wiredCardIds: ['c1', 'c2'] },
        { id: 'c1', kind: 'console' }
      ],
      groups: [],
      connectors: []
    } as never
    expect(boardRemovalOf(before, ['c1']).wiring).toEqual({ o: ['c1'] })
  })

  it('names one card, counts several', () => {
    expect(deletedToastMessage([{ title: 'Kanban', kind: 'kanban' }])).toBe('Deleted Kanban')
    expect(
      deletedToastMessage([
        { title: 'a', kind: 'note' },
        { title: 'b', kind: 'note' }
      ])
    ).toBe('Deleted 2 cards')
  })
})
