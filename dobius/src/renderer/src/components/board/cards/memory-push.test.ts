import { describe, expect, it } from 'vitest'
import type { BoardCard, BoardState } from '@/store/slices/board'
import { memoryPushTargets } from './memory-push'

const base = { x: 0, y: 0, w: 1, h: 1, z: 0, title: 't' }
const consoleCard = (id: string): BoardCard => ({
  ...base,
  id,
  kind: 'console',
  tabId: `tab-${id}`,
  agentKind: 'claude'
})

const board = {
  cards: [
    consoleCard('a'),
    consoleCard('b'),
    consoleCard('c'),
    { ...base, id: 'n', kind: 'note', text: '', color: 'yellow' }
  ],
  groups: [{ id: 'g', name: 'G', color: 'blue', cardIds: ['b', 'c', 'n'] }]
} as unknown as BoardState

describe('memoryPushTargets', () => {
  it('expands wired groups, keeps only consoles, dedupes', () => {
    expect(memoryPushTargets(board, ['a', 'g', 'b']).map((c) => c.id)).toEqual(['a', 'b', 'c'])
  })
  it('ignores stale ids and non-console cards', () => {
    expect(memoryPushTargets(board, ['gone', 'n'])).toEqual([])
  })
})
