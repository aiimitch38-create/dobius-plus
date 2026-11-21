import { describe, expect, it } from 'vitest'
import type { BoardCard } from '@/store/slices/board'
import { boardResetPlan } from './board-reset'

const base = { x: 0, y: 0, w: 100, h: 100, z: 1, title: 't' }

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
