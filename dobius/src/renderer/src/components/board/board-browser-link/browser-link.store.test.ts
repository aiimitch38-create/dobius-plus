// Persistence of the console ↔ tile driver link: survives sanitize, pruned
// when the console goes (removeCards) or is missing from a snapshot merge.
import { create } from 'zustand'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '@/store/types'
import {
  createBoardSlice,
  getBoard,
  resetBoardPersistenceForTest,
  sanitizeBoardsByWorktree,
  type BoardCard,
  type BoardState,
  type NewBoardCard
} from '@/store/slices/board'
import { mergeSnapshotBoard } from '@/store/slices/board-persistence'

// @ts-expect-error -- test shim
globalThis.window = { api: { ui: { set: vi.fn(() => Promise.resolve()) } } }

const WT = 'wt-1'
const createTestStore = () =>
  create<AppState>()((...a) => ({ ...createBoardSlice(...a) }) as AppState)

const consoleCard = (over: Partial<NewBoardCard> = {}): NewBoardCard =>
  ({
    kind: 'console',
    tabId: 'tab-1',
    agentKind: 'claude',
    title: 'Claude 1',
    x: 0,
    y: 0,
    w: 300,
    h: 200,
    ...over
  }) as NewBoardCard
const tileCard = (driverCardId?: string): NewBoardCard =>
  ({
    kind: 'web',
    url: 'http://localhost:5173/',
    title: 'Preview',
    x: 400,
    y: 0,
    w: 300,
    h: 200,
    ...(driverCardId ? { driverCardId } : {})
  }) as NewBoardCard

describe('web tile driverCardId', () => {
  let store: ReturnType<typeof createTestStore>
  const board = (): BoardState => getBoard(store.getState(), WT)
  const tileOf = (id: string): BoardCard | undefined => board().cards.find((c) => c.id === id)

  beforeEach(() => {
    resetBoardPersistenceForTest()
    store = createTestStore()
  })

  it('is set by updateCard and dropped when the console is removed', () => {
    const driver = store.getState().addCard(WT, consoleCard())
    const tile = store.getState().addCard(WT, tileCard())
    store.getState().updateCard(WT, tile, { driverCardId: driver })
    expect(tileOf(tile)).toMatchObject({ kind: 'web', driverCardId: driver })
    store.getState().removeCards(WT, [driver])
    const after = tileOf(tile)
    expect(after?.kind === 'web' && 'driverCardId' in after).toBe(false)
  })

  it('survives sanitize only as a string', () => {
    const boards = sanitizeBoardsByWorktree({
      [WT]: {
        cards: [
          { ...tileCard('drv'), id: 't', z: 1 },
          { ...tileCard(), id: 'u', z: 2, driverCardId: 42 }
        ],
        groups: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        tool: 'select'
      }
    })
    const cards = boards[WT].cards
    expect(cards.find((c) => c.id === 't')).toMatchObject({ driverCardId: 'drv' })
    expect('driverCardId' in cards.find((c) => c.id === 'u')!).toBe(false)
  })

  it('is pruned by a snapshot merge when the driver console is not in the result', () => {
    const base = { x: 0, y: 0, w: 100, h: 100, z: 1 }
    const live: BoardCard = {
      ...base,
      id: 'live',
      kind: 'console',
      tabId: 'tab-live',
      agentKind: 'claude',
      title: 'Claude 1'
    }
    const snapshot: BoardState = {
      cards: [
        {
          ...base,
          id: 'kept',
          kind: 'web',
          url: 'http://localhost:1/',
          title: 'A',
          driverCardId: 'live'
        },
        {
          ...base,
          id: 'orphan',
          kind: 'web',
          url: 'http://localhost:2/',
          title: 'B',
          driverCardId: 'gone'
        }
      ],
      groups: [],
      connectors: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      tool: 'select'
    }
    const current: BoardState = { ...snapshot, cards: [live] }
    const merged = mergeSnapshotBoard(current, snapshot)
    expect(merged.cards.find((c) => c.id === 'kept')).toMatchObject({ driverCardId: 'live' })
    expect('driverCardId' in merged.cards.find((c) => c.id === 'orphan')!).toBe(false)
  })
})
