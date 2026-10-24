import { describe, expect, it } from 'vitest'
import {
  EMPTY_BOARD_HISTORY,
  reconcileConsoleCards,
  recordBoardChange,
  redoBoardStep,
  sameBoardContent,
  undoBoardStep,
  type BoardContent
} from './board-history'

const content = (tag: string): BoardContent =>
  ({ cards: [{ id: tag }], groups: [], connectors: [] }) as unknown as BoardContent

describe('board history', () => {
  it('undoes and redoes in order', () => {
    const a = content('a')
    const b = content('b')
    const c = content('c')
    let h = recordBoardChange(EMPTY_BOARD_HISTORY, a)
    h = recordBoardChange(h, b)
    const u1 = undoBoardStep(h, c)!
    expect(u1.content).toBe(b)
    const u2 = undoBoardStep(u1.history, b)!
    expect(u2.content).toBe(a)
    expect(undoBoardStep(u2.history, a)).toBeNull()
    const r1 = redoBoardStep(u2.history, a)!
    expect(r1.content).toBe(b)
    const r2 = redoBoardStep(r1.history, b)!
    expect(r2.content).toBe(c)
    expect(redoBoardStep(r2.history, c)).toBeNull()
  })

  it('drops the redo branch when a new edit is recorded', () => {
    const a = content('a')
    const b = content('b')
    const undone = undoBoardStep(recordBoardChange(EMPTY_BOARD_HISTORY, a), b)!
    expect(undone.history.future).toHaveLength(1)
    expect(recordBoardChange(undone.history, a).future).toHaveLength(0)
  })

  it('caps the undo stack', () => {
    let h = EMPTY_BOARD_HISTORY
    for (let i = 0; i < 5; i++) {
      h = recordBoardChange(h, content(String(i)), 3)
    }
    expect(h.past.map((c) => (c.cards[0] as unknown as { id: string }).id)).toEqual(['2', '3', '4'])
  })

  it('compares content by identity', () => {
    const a = content('a')
    expect(sameBoardContent(a, { ...a })).toBe(true)
    expect(sameBoardContent(a, { ...a, cards: [] })).toBe(false)
  })
})

describe('reconcileConsoleCards', () => {
  const card = (id: string, kind: string, tabId?: string) =>
    ({ id, kind, tabId, x: 0, y: 0, w: 1, h: 1, z: 1, title: id }) as never

  it('never hides a console whose terminal is still alive (undo of a spawn)', () => {
    const before = { cards: [card('n1', 'note')], groups: [], connectors: [] } as BoardContent
    const now = {
      cards: [card('n1', 'note'), card('c1', 'console', 't1')],
      groups: [],
      connectors: []
    } as BoardContent
    const out = reconcileConsoleCards(before, now, new Set(['t1']))
    expect(out.cards.map((c) => c.id)).toEqual(['n1', 'c1'])
  })

  it('never shows a console whose terminal is gone (redo after close)', () => {
    const target = {
      cards: [card('c1', 'console', 't1'), card('n1', 'note')],
      groups: [{ id: 'g', name: 'G', color: 'blue', cardIds: ['c1'] }],
      connectors: []
    } as unknown as BoardContent
    const now = { cards: [card('n1', 'note')], groups: [], connectors: [] } as BoardContent
    const out = reconcileConsoleCards(target, now, new Set())
    expect(out.cards.map((c) => c.id)).toEqual(['n1'])
    expect(out.groups).toEqual([])
  })

  it('leaves non-console cards exactly as the snapshot has them', () => {
    const target = { cards: [card('n2', 'note')], groups: [], connectors: [] } as BoardContent
    const now = { cards: [card('n1', 'note')], groups: [], connectors: [] } as BoardContent
    expect(reconcileConsoleCards(target, now, new Set()).cards.map((c) => c.id)).toEqual(['n2'])
  })

  it('keeps a closed console the user still sees when an unrelated delete is undone', () => {
    // Before: kanban + Codex 2 (whose tab has since closed). Now: kanban erased.
    const before = {
      cards: [card('k1', 'kanban'), card('c2', 'console', 'dead')],
      groups: [],
      connectors: []
    } as BoardContent
    const now = {
      cards: [card('c2', 'console', 'dead')],
      groups: [],
      connectors: []
    } as BoardContent
    const out = reconcileConsoleCards(before, now, new Set())
    expect(out.cards.map((c) => c.id)).toEqual(['k1', 'c2'])
  })

  it('does not drop a closed console that the snapshot lacks (undo of an earlier add)', () => {
    const before = { cards: [card('n1', 'note')], groups: [], connectors: [] } as BoardContent
    const now = {
      cards: [card('n1', 'note'), card('c1', 'console', 'dead')],
      groups: [],
      connectors: []
    } as BoardContent
    expect(reconcileConsoleCards(before, now, new Set()).cards.map((c) => c.id)).toEqual([
      'n1',
      'c1'
    ])
  })
})
