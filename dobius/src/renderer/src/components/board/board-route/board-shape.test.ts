import { describe, expect, it } from 'vitest'
import type { BoardCard, BoardState } from '@/store/slices/board'
import {
  boardShapeSelector,
  consoleCountsByWorktree,
  sameBoardShape,
  sameCardShape
} from './board-shape'

const console1 = {
  id: 'c1',
  kind: 'console',
  title: 'Claude 1',
  tabId: 'tab-1',
  agentKind: 'claude',
  x: 40,
  y: 40,
  w: 520,
  h: 380,
  z: 1
} as BoardCard
const web1 = {
  id: 'w1',
  kind: 'web',
  title: 'Web 1',
  url: 'about:blank',
  x: 600,
  y: 40,
  w: 900,
  h: 600,
  z: 2
} as BoardCard

const board = (cards: BoardCard[], extra: Partial<BoardState> = {}): BoardState => ({
  cards,
  groups: [],
  connectors: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  tool: 'select',
  ...extra
})

// moveCards / resizeCard / bringToFront spread the card and overwrite geometry only.
const moved = (card: BoardCard, dx: number, dy: number): BoardCard => ({
  ...card,
  x: card.x + dx,
  y: card.y + dy
})

describe('sameCardShape', () => {
  it('ignores position, size and stacking', () => {
    expect(sameCardShape(console1, moved(console1, 7, -3))).toBe(true)
    expect(sameCardShape(console1, { ...console1, w: 1, h: 1 })).toBe(true)
    expect(sameCardShape(console1, { ...console1, z: 99 })).toBe(true)
  })
  it('sees every other field', () => {
    expect(sameCardShape(console1, { ...console1, title: 'Renamed' })).toBe(false)
    expect(sameCardShape(web1, { ...web1, driverCardId: 'c1' } as BoardCard)).toBe(false)
    expect(sameCardShape(console1, web1)).toBe(false)
  })
})

describe('sameBoardShape', () => {
  const a = board([console1, web1])
  it('is true for a position-only change (what every drag frame writes)', () => {
    const b = { ...a, cards: a.cards.map((c) => (c.id === 'c1' ? moved(c, 10, 10) : c)) }
    expect(sameBoardShape(a, b)).toBe(true)
  })
  it('is false when a card is added, removed, retitled, or the camera/tool/groups change', () => {
    expect(sameBoardShape(a, board([console1]))).toBe(false)
    expect(sameBoardShape(a, board([console1, web1, { ...console1, id: 'c2' }]))).toBe(false)
    expect(sameBoardShape(a, board([{ ...console1, title: 'X' }, web1]))).toBe(false)
    expect(sameBoardShape(a, { ...a, viewport: { x: 1, y: 0, zoom: 1 } })).toBe(false)
    expect(sameBoardShape(a, { ...a, tool: 'spawn' })).toBe(false)
    expect(sameBoardShape(a, { ...a, groups: [] })).toBe(false)
  })
})

describe('boardShapeSelector', () => {
  const wt = 'wt-1'
  it('returns the same board object across position-only writes, a new one on a shape change', () => {
    const select = boardShapeSelector(wt)
    const first = board([console1, web1])
    const got1 = select({ boardsByWorktree: { [wt]: first } })
    expect(got1).toBe(first)

    // 60 drag frames: new map, new board, new cards array, moved card each time.
    let current = first
    for (let i = 1; i <= 60; i++) {
      current = {
        ...current,
        cards: current.cards.map((c) => (c.id === 'c1' ? moved(c, 5, 2) : c))
      }
      expect(select({ boardsByWorktree: { [wt]: current } })).toBe(first)
    }

    const retitled = { ...current, cards: [{ ...console1, title: 'Claude 2' }, web1] }
    const got2 = select({ boardsByWorktree: { [wt]: retitled } })
    expect(got2).toBe(retitled)
    expect(got2).not.toBe(first)
  })
  it('does not leak one worktree board into another', () => {
    const select = boardShapeSelector('other')
    expect(select({ boardsByWorktree: { [wt]: board([console1]) } }).cards).toEqual([])
  })
})

describe('consoleCountsByWorktree', () => {
  it('is shallow-equal across a position-only change', () => {
    const boards = { a: board([console1, web1]), b: board([web1]) }
    const movedBoards = { ...boards, a: { ...boards.a, cards: [moved(console1, 3, 3), web1] } }
    expect(consoleCountsByWorktree(boards)).toEqual({ a: 1, b: 0 })
    expect(consoleCountsByWorktree(movedBoards)).toEqual(consoleCountsByWorktree(boards))
  })
})
