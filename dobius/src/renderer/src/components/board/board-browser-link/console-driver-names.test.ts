import { describe, expect, it, vi } from 'vitest'
import type { BoardCard } from '@/store/slices/board'

vi.mock('@/store', () => ({ useAppStore: { getState: () => ({ boardsByWorktree: {} }) } }))

const { resolveConsoleDriverName } = await import('./console-driver-names')

const base = { x: 0, y: 0, w: 100, h: 100, z: 1 }
const consoleCard = (id: string, title: string): BoardCard => ({
  ...base,
  id,
  kind: 'console',
  tabId: `tab-${id}`,
  agentKind: 'claude',
  title
})

describe('resolveConsoleDriverName', () => {
  it('finds the console title across boards and leaves other agents alone', () => {
    const boards = {
      a: { cards: [consoleCard('11111111-aaaa', 'Claude 1')] },
      b: { cards: [consoleCard('22222222-bbbb', 'Codex 2')] }
    }
    expect(resolveConsoleDriverName(boards, 'console-22222222')).toBe('Codex 2')
    expect(resolveConsoleDriverName(boards, 'console-11111111')).toBe('Claude 1')
    expect(resolveConsoleDriverName(boards, 'console-33333333')).toBeNull()
    expect(resolveConsoleDriverName(boards, 'adam')).toBeNull()
  })

  it('falls back to the capitalized id for a reserved title', () => {
    const boards = { a: { cards: [consoleCard('11111111-aaaa', 'Dobius AI')] } }
    expect(resolveConsoleDriverName(boards, 'console-11111111')).toBe('Console-11111111')
  })
})
