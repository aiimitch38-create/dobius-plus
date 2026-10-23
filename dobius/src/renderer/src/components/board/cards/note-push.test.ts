import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { BoardState } from '@/store/slices/board'

const deliver = vi.fn()
const state = { boardsByWorktree: {} as Record<string, BoardState> }
vi.mock('../board-delivery/board-delivery', () => ({ deliverOrder: (a: unknown) => deliver(a) }))
vi.mock('@/store', () => ({ useAppStore: { getState: () => state } }))

const { notePushTargets, pushNoteToConsole } = await import('./note-push')

const board = {
  cards: [
    { id: 'c1', kind: 'console', tabId: 't1', title: 'Claude' },
    { id: 'n', kind: 'note', title: 'Note' }
  ],
  groups: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  tool: 'select'
} as unknown as BoardState

describe('note push', () => {
  beforeEach(() => {
    deliver.mockReset()
    state.boardsByWorktree = { wt: board }
  })

  it('offers only consoles on the board', () => {
    expect(notePushTargets(board)).toEqual([{ cardId: 'c1', tabId: 't1', title: 'Claude' }])
  })

  it('goes through the Board delivery queue to the chosen console only', async () => {
    deliver.mockResolvedValue({ ok: true, text: 'Sent to Claude.' })
    expect(await pushNoteToConsole('wt', 't1', 'remember X')).toBeNull()
    expect(deliver).toHaveBeenCalledWith({
      worktreeId: 'wt',
      summary: 'remember X',
      lanes: [{ tabId: 't1', name: 'Claude', text: 'remember X' }]
    })
  })

  it('reports failures and never targets consoles off the board', async () => {
    expect(await pushNoteToConsole('wt', 'not-on-board', 'x')).toMatch(/no longer available/)
    expect(deliver).not.toHaveBeenCalled()
    deliver.mockResolvedValue({
      ok: false,
      text: 'Claude is at its shell; restart it to send work.'
    })
    expect(await pushNoteToConsole('wt', 't1', 'x')).toMatch(/at its shell/)
  })
})
