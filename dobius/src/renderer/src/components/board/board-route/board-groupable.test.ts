import { describe, expect, it, vi } from 'vitest'
import { groupableCardIds, groupBoardCards } from './board-groupable'

const createGroup = vi.fn()
const state = {
  boardsByWorktree: {
    wt: { cards: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], groups: [{ id: 'g1' }] }
  },
  createGroup
}
vi.mock('@/store', () => ({ useAppStore: { getState: () => state } }))

describe('groupableCardIds', () => {
  const cards = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  it('groups two or more selected cards of any kind, in board order', () => {
    expect(groupableCardIds(cards, new Set(['c', 'a']))).toEqual(['a', 'c'])
  })
  it('refuses a single card or a selection of missing ids', () => {
    expect(groupableCardIds(cards, new Set(['a']))).toBeNull()
    expect(groupableCardIds(cards, new Set(['x', 'y']))).toBeNull()
  })
})

describe('groupBoardCards', () => {
  it('frames just-spawned cards from the live board as the next numbered group', () => {
    expect(groupBoardCards('wt', new Set(['b', 'c']))).toBe(true)
    expect(createGroup).toHaveBeenCalledWith('wt', { name: 'Group 2', cardIds: ['b', 'c'] })
  })
  it('makes no group when fewer than two of the cards exist', () => {
    createGroup.mockClear()
    expect(groupBoardCards('wt', new Set(['b', 'gone']))).toBe(false)
    expect(createGroup).not.toHaveBeenCalled()
  })
})
