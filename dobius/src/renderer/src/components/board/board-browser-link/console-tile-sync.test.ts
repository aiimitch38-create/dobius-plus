import { describe, expect, it, vi } from 'vitest'
import type { BoardCard } from '@/store/slices/board'

vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ boardsByWorktree: {} }), subscribe: vi.fn() }
}))

const { consoleTileBindings } = await import('./console-tile-sync')

const base = { x: 0, y: 0, w: 100, h: 100, z: 1 }
const consoleCard = (id: string): BoardCard => ({
  ...base,
  id,
  kind: 'console',
  tabId: `tab-${id}`,
  agentKind: 'claude',
  title: id
})
const tile = (id: string, driverCardId?: string): BoardCard => ({
  ...base,
  id,
  kind: 'web',
  url: 'http://localhost:1/',
  title: id,
  ...(driverCardId ? { driverCardId } : {})
})

describe('consoleTileBindings', () => {
  it('lists only links whose console is on the same board, sorted', () => {
    const boards = {
      a: { cards: [consoleCard('22222222-b'), tile('t2', '22222222-b'), tile('t1', '22222222-b')] },
      b: { cards: [tile('t3', '22222222-b'), consoleCard('11111111-a'), tile('t4', '11111111-a')] }
    }
    expect(consoleTileBindings(boards)).toEqual([
      { agentId: 'console-11111111', tileId: 't4' },
      { agentId: 'console-22222222', tileId: 't1' },
      { agentId: 'console-22222222', tileId: 't2' }
    ])
  })
})
