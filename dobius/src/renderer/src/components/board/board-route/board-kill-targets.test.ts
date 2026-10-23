import { describe, expect, it } from 'vitest'
import { boardCardsWithClosedTabs } from './board-kill-targets'

describe('boardCardsWithClosedTabs', () => {
  it('returns only cards whose tab is gone from every worktree', () => {
    const targets = [
      { cardId: 'c1', tabId: 't1' },
      { cardId: 'c2', tabId: 't2' },
      { cardId: 'c3', tabId: 't3' }
    ]
    expect(boardCardsWithClosedTabs(targets, { w1: [{ id: 't2' }], w2: [{ id: 't3' }] })).toEqual([
      'c1'
    ])
    expect(boardCardsWithClosedTabs(targets, {})).toEqual(['c1', 'c2', 'c3'])
  })
})
