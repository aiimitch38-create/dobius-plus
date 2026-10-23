import { create } from 'zustand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '../types'
import {
  createBoardSlice,
  getBoard,
  resetBoardPersistenceForTest,
  sanitizeBoardsByWorktree,
  type NewBoardCard
} from './board'

const mockApi = { ui: { set: vi.fn(() => Promise.resolve()) } }
// @ts-expect-error -- test shim
globalThis.window = { api: mockApi }

const WT = 'wt-1'
const note = (id: string): NewBoardCard =>
  ({
    id,
    kind: 'note',
    text: '',
    color: 'yellow',
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    title: id
  }) as NewBoardCard

function createTestStore() {
  return create<AppState>()((...a) => ({ ...createBoardSlice(...a) }) as AppState)
}

describe('board connectors', () => {
  let store: ReturnType<typeof createTestStore>
  const board = () => getBoard(store.getState(), WT)

  beforeEach(() => {
    vi.useFakeTimers()
    resetBoardPersistenceForTest()
    store = createTestStore()
    store.getState().hydrateBoards({})
    store.getState().addCard(WT, note('a'))
    store.getState().addCard(WT, note('b'))
  })

  afterEach(() => vi.useRealTimers())

  it('adds a connector between two cards and refuses self or missing ends', () => {
    expect(store.getState().addConnector(WT, { fromCardId: 'a', toCardId: 'b' })).toBeTruthy()
    expect(store.getState().addConnector(WT, { fromCardId: 'a', toCardId: 'a' })).toBeNull()
    expect(store.getState().addConnector(WT, { fromCardId: 'a', toCardId: 'zzz' })).toBeNull()
    expect(board().connectors).toHaveLength(1)
  })

  it('drops connectors with a removed card, and removes by id', () => {
    const id = store.getState().addConnector(WT, { fromCardId: 'a', toCardId: 'b' })!
    store.getState().addCard(WT, note('c'))
    const keep = store.getState().addConnector(WT, { fromCardId: 'b', toCardId: 'c' })!
    store.getState().removeCards(WT, ['a'])
    expect(board().connectors?.map((c) => c.id)).toEqual([keep])
    store.getState().removeConnectors(WT, [keep])
    expect(board().connectors).toEqual([])
    expect(id).not.toBe(keep)
  })
})

describe('connector and team-agent persistence', () => {
  const card = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    title: id,
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    z: 1,
    kind: 'note',
    text: '',
    color: 'yellow',
    ...extra
  })

  it('keeps valid connectors and orchestrator teamAgent, drops dangling ones', () => {
    const out = sanitizeBoardsByWorktree({
      [WT]: {
        cards: [
          card('a'),
          card('b'),
          { ...card('o'), kind: 'orchestrator', name: 'O', wiredCardIds: [], teamAgent: 'codex' }
        ],
        connectors: [
          { id: 'k1', fromCardId: 'a', toCardId: 'b', label: 'calls', style: { stroke: 'blue' } },
          { id: 'k2', fromCardId: 'a', toCardId: 'gone' },
          { id: 'k3', fromCardId: 'a', toCardId: 'a' }
        ]
      }
    })[WT]
    expect(out.connectors).toHaveLength(1)
    expect(out.connectors?.[0]).toMatchObject({
      id: 'k1',
      label: 'calls',
      style: { stroke: 'blue' }
    })
    expect(out.cards.find((c) => c.id === 'o')).toMatchObject({ teamAgent: 'codex' })
  })
})
