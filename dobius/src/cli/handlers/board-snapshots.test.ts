import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveCurrentWorktreeSelectorMock = vi.hoisted(() => vi.fn())
const printResultMock = vi.hoisted(() => vi.fn())

vi.mock('../format', () => ({ printResult: printResultMock }))
vi.mock('../selectors', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveCurrentWorktreeSelector: resolveCurrentWorktreeSelectorMock
}))

import { BOARD_SNAPSHOT_HANDLERS, formatSnapshotList } from './board-snapshots'

const callMock = vi.fn()
const run = (command: string, flags: Record<string, string | boolean>) =>
  BOARD_SNAPSHOT_HANDLERS[command]({
    flags: new Map(Object.entries(flags)),
    client: { call: callMock, isRemote: false } as never,
    cwd: '/repo/wt-1',
    json: true
  })

describe('board snapshots commands', () => {
  beforeEach(() => {
    resolveCurrentWorktreeSelectorMock.mockReset().mockResolvedValue('id:wt-1')
    callMock.mockReset().mockResolvedValue({ result: {} })
  })

  it('list, read (with --source) and capture call their RPC methods on the active worktree', async () => {
    await run('board snapshots list', {})
    await run('board snapshots read', { id: '1-hourly.json', source: 'gone' })
    await run('board snapshots capture', {})
    expect(callMock.mock.calls).toEqual([
      ['board.snapshotList', { worktree: 'id:wt-1' }],
      ['board.snapshotRead', { worktree: 'id:wt-1', id: '1-hourly.json', source: 'gone' }],
      ['board.snapshotCapture', { worktree: 'id:wt-1' }]
    ])
  })

  it('read needs --id', async () => {
    await expect(run('board snapshots read', {})).rejects.toThrow(/--id/)
  })

  it('formats rows, marking archived boards', () => {
    expect(
      formatSnapshotList({
        worktreeId: 'wt-1',
        totalCount: 1,
        truncated: false,
        snapshots: [
          { id: 'archive/0-closed-board.json', worktreeId: 'gone', takenAt: 0, reason: 'closed-board', archived: true, cards: 3, consoles: 1 }
        ]
      })
    ).toBe('archive/0-closed-board.json  1970-01-01T00:00:00.000Z  closed-board (archived from gone)  3 cards, 1 consoles')
  })
})
