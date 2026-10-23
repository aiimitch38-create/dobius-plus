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

function createTestStore() {
  return create<AppState>()((...a) => ({ ...createBoardSlice(...a) }) as AppState)
}

const note = (over: Partial<NewBoardCard> = {}): NewBoardCard =>
  ({
    kind: 'note',
    text: 'hi',
    color: 'yellow',
    x: 0,
    y: 0,
    w: 200,
    h: 150,
    title: 'Note',
    ...over
  }) as NewBoardCard

describe('board slice', () => {
  let store: ReturnType<typeof createTestStore>
  const board = () => getBoard(store.getState(), WT)

  beforeEach(() => {
    vi.useFakeTimers()
    mockApi.ui.set.mockClear()
    resetBoardPersistenceForTest()
    store = createTestStore()
    store.getState().hydrateBoards({})
  })
  afterEach(() => vi.useRealTimers())

  it('returns a stable empty board for unknown worktrees', () => {
    expect(getBoard(store.getState(), 'nope')).toBe(getBoard(store.getState(), null))
    expect(board().tool).toBe('select')
  })

  it('addCard assigns id and stacks z above existing cards', () => {
    const a = store.getState().addCard(WT, note())
    const b = store.getState().addCard(WT, note({ id: 'fixed' }))
    expect(b).toBe('fixed')
    const [ca, cb] = board().cards
    expect(ca.id).toBe(a)
    expect(cb.z).toBeGreaterThan(ca.z)
  })

  it('updateCard merges a patch and leaves other boards untouched', () => {
    const id = store.getState().addCard(WT, note())
    store.getState().updateCard(WT, id, { text: 'changed', title: 'T' })
    expect(board().cards[0]).toMatchObject({ text: 'changed', title: 'T', kind: 'note' })
    expect(store.getState().boardsByWorktree.other).toBeUndefined()
  })

  it('moveCards applies world deltas to only the given cards', () => {
    const a = store.getState().addCard(WT, note({ x: 10, y: 10 }))
    store.getState().addCard(WT, note({ x: 50, y: 50 }))
    store.getState().moveCards(WT, [a], 5, -3)
    expect(board().cards.map((c) => [c.x, c.y])).toEqual([
      [15, 7],
      [50, 50]
    ])
  })

  it('moveCards with zero delta does not change state', () => {
    store.getState().addCard(WT, note())
    const before = store.getState().boardsByWorktree
    store.getState().moveCards(WT, [board().cards[0].id], 0, 0)
    expect(store.getState().boardsByWorktree).toBe(before)
  })

  it('resizeCard sets the rect and keeps size positive', () => {
    const id = store.getState().addCard(WT, note())
    store.getState().resizeCard(WT, id, { x: 1, y: 2, w: -5, h: 40 })
    expect(board().cards[0]).toMatchObject({ x: 1, y: 2, w: 1, h: 40 })
  })

  it('removeCards prunes groups and orchestrator wiring', () => {
    const a = store.getState().addCard(WT, note())
    const b = store.getState().addCard(WT, note())
    const o = store.getState().addCard(WT, {
      kind: 'orchestrator',
      name: 'Lead',
      wiredCardIds: [],
      x: 0,
      y: 0,
      w: 300,
      h: 200,
      title: 'Lead'
    })
    store.getState().updateCard(WT, o, { wiredCardIds: [a, b] })
    const solo = store.getState().createGroup(WT, { name: 'solo', cardIds: [a] })
    store.getState().createGroup(WT, { name: 'pair', cardIds: [b, o] })
    store.getState().removeCards(WT, [a])
    expect(board().cards.map((c) => c.id)).toEqual([b, o])
    expect(board().groups.find((g) => g.id === solo)).toBeUndefined()
    const orch = board().cards.find((c) => c.id === o)
    expect(orch?.kind === 'orchestrator' && orch.wiredCardIds).toEqual([b])
  })

  it('bringToFront lifts the selection keeping its relative order', () => {
    const a = store.getState().addCard(WT, note())
    const b = store.getState().addCard(WT, note())
    const c = store.getState().addCard(WT, note())
    store.getState().bringToFront(WT, [b, a])
    const z = Object.fromEntries(board().cards.map((card) => [card.id, card.z]))
    expect(z[a]).toBeGreaterThan(z[c])
    expect(z[b]).toBeGreaterThan(z[a])
  })

  it('createGroup keeps known cards only and moves cards out of other groups', () => {
    const a = store.getState().addCard(WT, note())
    const b = store.getState().addCard(WT, note())
    const g1 = store.getState().createGroup(WT, { name: 'one', cardIds: [a, b, 'ghost'] })
    const g2 = store.getState().createGroup(WT, { name: 'two', color: 'blue', cardIds: [b] })
    const groups = board().groups
    expect(groups.find((g) => g.id === g1)?.cardIds).toEqual([a])
    expect(groups.find((g) => g.id === g2)).toMatchObject({ color: 'blue', cardIds: [b] })
  })

  it('addToGroup adds new members and drops groups it empties', () => {
    const a = store.getState().addCard(WT, note())
    const b = store.getState().addCard(WT, note())
    const g1 = store.getState().createGroup(WT, { name: 'one', cardIds: [a] })
    const g2 = store.getState().createGroup(WT, { name: 'two', cardIds: [b] })
    store.getState().addToGroup(WT, g1, [b, a])
    expect(board().groups).toHaveLength(1)
    expect(board().groups[0]).toMatchObject({ id: g1, cardIds: [a, b] })
    expect(board().groups.some((g) => g.id === g2)).toBe(false)
  })

  it('dissolveGroup removes the group but keeps its cards', () => {
    const a = store.getState().addCard(WT, note())
    const g = store.getState().createGroup(WT, { name: 'one', cardIds: [a] })
    store.getState().dissolveGroup(WT, g)
    expect(board().groups).toEqual([])
    expect(board().cards).toHaveLength(1)
  })

  it('updateGroup renames and recolors only that group', () => {
    const a = store.getState().addCard(WT, note())
    const g = store.getState().createGroup(WT, { name: 'one', cardIds: [a] })
    store.getState().updateGroup(WT, g, { name: 'Reviewers', color: 'pink' })
    expect(board().groups[0]).toMatchObject({ name: 'Reviewers', color: 'pink', cardIds: [a] })
    const before = store.getState().boardsByWorktree
    store.getState().updateGroup(WT, 'missing', { name: 'x' })
    expect(store.getState().boardsByWorktree).toBe(before)
  })

  it('setViewport merges and clamps zoom', () => {
    store.getState().setViewport(WT, { x: 100, zoom: 99 })
    expect(board().viewport).toEqual({ x: 100, y: 0, zoom: 3 })
    store.getState().setViewport(WT, { zoom: 0 })
    expect(board().viewport.zoom).toBe(0.1)
  })

  it('setTool changes the tool per worktree', () => {
    store.getState().setTool(WT, 'pen')
    expect(board().tool).toBe('pen')
    expect(getBoard(store.getState(), 'wt-2').tool).toBe('select')
  })

  it('persists once per burst, only after hydration', () => {
    const fresh = createTestStore()
    fresh.getState().setTool(WT, 'pen')
    vi.runAllTimers()
    expect(mockApi.ui.set).not.toHaveBeenCalled()

    store.getState().setViewport(WT, { x: 1 })
    store.getState().setViewport(WT, { x: 2 })
    store.getState().setViewport(WT, { x: 3 })
    vi.runAllTimers()
    expect(mockApi.ui.set).toHaveBeenCalledTimes(1)
    const [arg] = mockApi.ui.set.mock.calls[0] as unknown as [
      { boardsByWorktree: Record<string, unknown> }
    ]
    expect(sanitizeBoardsByWorktree(arg.boardsByWorktree)[WT].viewport.x).toBe(3)
  })

  it('hydrate-before-write: edits made before hydration never overwrite saved boards', () => {
    const fresh = createTestStore()
    fresh.getState().addCard(WT, note({ id: 'boot-edit' }))
    vi.runAllTimers()
    expect(mockApi.ui.set).not.toHaveBeenCalled()

    const saved = {
      [WT]: {
        cards: [
          { id: 'saved', kind: 'text', text: 't', x: 0, y: 0, w: 10, h: 10, z: 1, title: 'T' }
        ],
        groups: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        tool: 'select'
      }
    }
    fresh.getState().hydrateBoards(saved)
    // Saved boards win, and the card made before hydration is kept alongside them.
    expect(getBoard(fresh.getState(), WT).cards.map((c) => c.id)).toEqual(['saved', 'boot-edit'])

    fresh.getState().setTool(WT, 'pen')
    vi.runAllTimers()
    const [arg] = mockApi.ui.set.mock.calls[0] as unknown as [{ boardsByWorktree: unknown }]
    expect(sanitizeBoardsByWorktree(arg.boardsByWorktree)[WT].cards.map((c) => c.id)).toEqual([
      'saved',
      'boot-edit'
    ])
  })

  it('ignores its own echoed write and reloads that land while an edit is pending', () => {
    store.getState().setViewport(WT, { x: 5 })
    vi.runAllTimers()
    const [arg] = mockApi.ui.set.mock.calls[0] as unknown as [{ boardsByWorktree: unknown }]
    const before = store.getState().boardsByWorktree
    store.getState().hydrateBoards(JSON.parse(JSON.stringify(arg.boardsByWorktree)))
    expect(store.getState().boardsByWorktree).toBe(before)

    store.getState().setViewport(WT, { x: 9 })
    store.getState().hydrateBoards({})
    expect(board().viewport.x).toBe(9)

    vi.runAllTimers()
    store.getState().hydrateBoards({})
    expect(store.getState().boardsByWorktree).toEqual({})
  })

  it('rejects NaN zoom and pan', () => {
    store.getState().setViewport(WT, { x: 10, zoom: Number.NaN })
    expect(board().viewport).toEqual({ x: 10, y: 0, zoom: 1 })
    store.getState().setViewport(WT, { x: Number.NaN })
    expect(board().viewport.x).toBe(10)
  })

  it('camera moves persist only after the gesture settles', () => {
    store.getState().setViewport(WT, { x: 1 })
    vi.advanceTimersByTime(500)
    store.getState().setViewport(WT, { x: 2 })
    vi.advanceTimersByTime(900)
    expect(mockApi.ui.set).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(mockApi.ui.set).toHaveBeenCalledTimes(1)
  })

  it('never writes oversized embedded images and drops them on hydrate', () => {
    const big = `data:image/png;base64,${'A'.repeat(70 * 1024)}`
    store.getState().addCard(WT, {
      kind: 'image',
      src: big,
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      title: 'I'
    } as NewBoardCard)
    store.getState().addCard(WT, note({ id: 'keep' }))
    vi.runAllTimers()
    const [arg] = mockApi.ui.set.mock.calls[0] as unknown as [
      { boardsByWorktree: Record<string, { cards: { id: string }[] }> }
    ]
    expect(arg.boardsByWorktree[WT].cards.map((c) => c.id)).toEqual(['keep'])
    expect(
      sanitizeBoardsByWorktree({
        [WT]: {
          cards: [{ id: 'i', kind: 'image', src: big, x: 0, y: 0, w: 1, h: 1, z: 1, title: 'I' }]
        }
      })[WT].cards
    ).toEqual([])
  })

  it('merges broadcasts per worktree while a local edit is pending', () => {
    store.getState().setTool(WT, 'pen')
    store.getState().hydrateBoards({
      [WT]: { cards: [], groups: [], viewport: { x: 0, y: 0, zoom: 1 }, tool: 'eraser' },
      other: { cards: [], groups: [], viewport: { x: 7, y: 0, zoom: 1 }, tool: 'select' }
    })
    expect(board().tool).toBe('pen')
    expect(getBoard(store.getState(), 'other').viewport.x).toBe(7)
  })

  it('removeBoards drops removed worktrees and persists the removal', () => {
    store.getState().setTool(WT, 'pen')
    store.getState().setTool('wt-2', 'pen')
    vi.runAllTimers()
    mockApi.ui.set.mockClear()
    store.getState().removeBoards([WT, 'never-had-one'])
    expect(store.getState().boardsByWorktree[WT]).toBeUndefined()
    vi.runAllTimers()
    const [arg] = mockApi.ui.set.mock.calls[0] as unknown as [
      { boardsByWorktree: Record<string, unknown> }
    ]
    expect(Object.keys(arg.boardsByWorktree)).toEqual(['wt-2'])
  })

  it('sanitizes card styles on hydrate and keeps unstyled cards unstyled', () => {
    const card = (extra: object) => ({ x: 0, y: 0, w: 10, h: 10, z: 1, title: 'T', ...extra })
    const out = sanitizeBoardsByWorktree({
      [WT]: {
        cards: [
          card({
            id: 's',
            kind: 'shape',
            shape: 'arrow',
            fill: 'blue',
            style: { stroke: '#zzzzzz', strokeWidth: 'bold', opacity: 999, sloppiness: 'wild' }
          }),
          card({ id: 'p', kind: 'shape', shape: 'rect', fill: 'blue' }),
          card({ id: 'k', kind: 'stroke', points: [[0, 0]], style: { strokeStyle: 'dashed' } }),
          card({
            id: 't',
            kind: 'text',
            text: 'hi',
            style: { textSize: 'xlarge', textAlign: 'center' }
          }),
          card({ id: 'n', kind: 'shape', shape: 'sticky', fill: 'pink', text: 'note' }),
          card({ id: 'l', kind: 'shape', shape: 'line', fill: 'nope' })
        ],
        groups: []
      }
    })[WT].cards
    const by = (id: string) => out.find((c) => c.id === id)!
    expect(by('s')).toMatchObject({
      kind: 'shape',
      shape: 'arrow',
      style: { stroke: 'text', strokeWidth: 'bold', opacity: 100, sloppiness: 'artist' }
    })
    expect('style' in by('p')).toBe(false)
    expect(by('k')).toMatchObject({ style: { strokeStyle: 'dashed', strokeWidth: 'medium' } })
    expect(by('t')).toMatchObject({ style: { textSize: 'xlarge', textAlign: 'center' } })
    expect(by('n')).toMatchObject({ kind: 'note', text: 'note', color: 'pink' })
    expect(by('l')).toMatchObject({ kind: 'shape', shape: 'line', fill: 'accent' })
  })

  it('hydrateBoards drops malformed cards and dangling group members', () => {
    store.getState().hydrateBoards({
      [WT]: {
        cards: [
          { id: 'ok', kind: 'text', text: 't', x: 0, y: 0, w: 10, h: 10, z: 1, title: 'T' },
          { id: 'bad', kind: 'text', x: 0, y: 0, w: 10, h: 10, z: 1, title: 'T' },
          { id: 'weird', kind: 'nope', x: 0, y: 0, w: 10, h: 10, z: 1, title: 'T' }
        ],
        groups: [{ id: 'g', name: 'G', color: 'bogus', cardIds: ['ok', 'bad'] }],
        viewport: { x: 'x', zoom: 50 },
        tool: 'laser'
      },
      broken: 'nope'
    })
    const b = board()
    expect(b.cards.map((c) => c.id)).toEqual(['ok'])
    expect(b.groups).toEqual([{ id: 'g', name: 'G', color: 'accent', cardIds: ['ok'] }])
    expect(b.viewport).toEqual({ x: 0, y: 0, zoom: 3 })
    expect(b.tool).toBe('select')
    expect(store.getState().boardsByWorktree.broken).toBeUndefined()
  })
})
