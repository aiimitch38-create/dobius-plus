import { describe, expect, it, vi } from 'vitest'
import type { BoardState } from '@/store/slices/board'

vi.mock('@/components/terminal/terminal-tab-actions', () => ({ closeTerminalTab: vi.fn() }))
vi.mock('@/store', () => ({ useAppStore: { getState: vi.fn() } }))

const { groupAddress, planGroupDelete } = await import('./group-lifecycle')

const board = {
  cards: [
    { id: 'c1', kind: 'console', tabId: 't1' },
    { id: 'c2', kind: 'console', tabId: 't2' },
    { id: 'n1', kind: 'note' }
  ],
  groups: [{ id: 'g', name: 'Team A', color: 'blue', cardIds: ['c1', 'n1'] }],
  viewport: { x: 0, y: 0, zoom: 1 },
  tool: 'select'
} as unknown as BoardState

describe('planGroupDelete', () => {
  it('targets only the console members of the group', () => {
    expect(planGroupDelete(board, 'g')).toEqual({ cardIds: ['c1'], tabIds: ['t1'] })
    expect(planGroupDelete(board, 'missing')).toEqual({ cardIds: [], tabIds: [] })
  })
})

describe('groupAddress', () => {
  it('slugs names the same way main resolves them', () => {
    expect(groupAddress(' Team  A ')).toBe('@team-a')
    expect(groupAddress('team_b')).toBe('@team-b')
  })
})
