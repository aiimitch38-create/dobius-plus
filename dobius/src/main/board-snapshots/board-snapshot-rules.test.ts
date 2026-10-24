import { describe, expect, it } from 'vitest'
import {
  BOARD_SNAPSHOT_KEEP,
  boardContentKey,
  boardCounts,
  parseSnapshotFileName,
  removedBoardIds,
  snapshotFileName,
  snapshotsToPrune,
  worktreeFolderName
} from './board-snapshot-rules'

describe('board snapshot rules', () => {
  it('round-trips file names and rejects anything else', () => {
    expect(parseSnapshotFileName(snapshotFileName(1_700_000_000_000, 'hourly'))).toEqual({
      takenAt: 1_700_000_000_000,
      reason: 'hourly'
    })
    expect(parseSnapshotFileName('1700000000000-evil.json')).toBeNull()
    expect(parseSnapshotFileName('../1700000000000-hourly.json')).toBeNull()
  })

  it('keeps the newest 24 autosaves and never prunes archived closed boards', () => {
    const names = Array.from({ length: 30 }, (_, i) =>
      snapshotFileName(1_700_000_000_000 + i * 1000, i % 2 ? 'hourly' : 'quit')
    )
    const archived = snapshotFileName(1_600_000_000_000, 'closed-board')
    const pruned = snapshotsToPrune([...names, archived])
    expect(BOARD_SNAPSHOT_KEEP).toBe(24)
    expect(pruned).toEqual(names.slice(0, 6))
    expect(pruned).not.toContain(archived)
    expect(snapshotsToPrune(names.slice(0, 24))).toEqual([])
  })

  it('counts cards and consoles for the list preview', () => {
    expect(
      boardCounts({ cards: [{ kind: 'console' }, { kind: 'note' }, { kind: 'console' }] })
    ).toEqual({ cards: 3, consoles: 2 })
    expect(boardCounts(null)).toEqual({ cards: 0, consoles: 0 })
  })

  it('ignores the camera when deciding whether a board changed', () => {
    const board = { cards: [{ id: 'a' }], groups: [], viewport: { x: 0, y: 0, zoom: 1 } }
    expect(boardContentKey(board)).toBe(
      boardContentKey({ ...board, viewport: { x: 50, y: 9, zoom: 2 } })
    )
    expect(boardContentKey(board)).not.toBe(boardContentKey({ ...board, cards: [] }))
  })

  it('finds boards that disappeared and hashes worktree ids into safe folder names', () => {
    expect(removedBoardIds({ a: {}, b: {} }, { b: {} })).toEqual(['a'])
    expect(removedBoardIds(undefined, { b: {} })).toEqual([])
    expect(worktreeFolderName('repo::/Users/me/a b/../x')).toMatch(/^[0-9a-f]{32}$/)
  })
})
