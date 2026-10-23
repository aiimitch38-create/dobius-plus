import { describe, expect, it } from 'vitest'
import { groupableCardIds } from './board-groupable'

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
