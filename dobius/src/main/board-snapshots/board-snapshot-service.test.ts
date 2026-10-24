import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { worktreeFolderName } from './board-snapshot-rules'
import { BoardSnapshotService } from './board-snapshot-service'

const board = (n: number) => ({
  cards: Array.from({ length: n }, (_, i) => ({ id: `c${i}`, kind: i === 0 ? 'console' : 'note' })),
  groups: [],
  viewport: { x: 0, y: 0, zoom: 1 }
})

describe('BoardSnapshotService', () => {
  let root: string
  let clock: number
  let service: BoardSnapshotService
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'board-snapshots-'))
    clock = 1_700_000_000_000
    service = new BoardSnapshotService(root, () => clock)
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('skips empty and unchanged boards, and keeps only the newest 24 autosaves', () => {
    expect(service.capture('wt', board(0), 'hourly')).toBe(false)
    expect(service.capture('wt', board(1), 'hourly')).toBe(true)
    clock += 1000
    expect(service.capture('wt', board(1), 'hourly')).toBe(false)
    for (let i = 2; i < 40; i += 1) {
      clock += 1000
      service.capture('wt', board(i), 'hourly')
    }
    expect(readdirSync(join(root, worktreeFolderName('wt')))).toHaveLength(24)
    // A fresh service (next launch) still recognises the unchanged board.
    const next = new BoardSnapshotService(root, () => clock + 5000)
    expect(next.capture('wt', board(39), 'quit')).toBe(false)
  })

  it('archives a board when it disappears and lists it from any workspace', () => {
    service.capture('wt-a', board(2), 'hourly')
    clock += 1000
    expect(
      service.archiveRemoved({ 'wt-gone': board(3), 'wt-a': board(2) }, { 'wt-a': board(2) })
    ).toBe(1)
    const list = service.list('wt-a')
    expect(list.map((m) => [m.worktreeId, m.reason, m.archived, m.cards, m.consoles])).toEqual([
      ['wt-gone', 'closed-board', true, 3, 1],
      ['wt-a', 'hourly', false, 2, 1]
    ])
    const archived = list[0]
    expect(service.read(archived.worktreeId, archived.id)?.board).toEqual(board(3))
    // Archives are never pruned by later autosaves.
    for (let i = 0; i < 30; i += 1) {
      clock += 1000
      service.capture('wt-gone', board(4 + i), 'hourly')
    }
    expect(service.list('wt-gone').filter((m) => m.archived)).toHaveLength(1)
  })

  it('refuses ids that could leave the snapshot folder', () => {
    expect(service.read('wt', '../../etc/passwd')).toBeNull()
    expect(service.read('wt', 'archive/../x.json')).toBeNull()
  })
})
