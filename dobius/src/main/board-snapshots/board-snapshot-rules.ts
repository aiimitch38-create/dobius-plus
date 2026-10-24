import { createHash } from 'node:crypto'
import type { BoardSnapshotMeta, BoardSnapshotReason } from '../../shared/board-snapshot-types'

// Pure rules for Board snapshots: file naming, what to keep, and the counts a
// snapshot list shows. The service in board-snapshot-service.ts does the I/O.

/** Autosaves kept per worktree (hourly, on quit, on leaving the Board). Archives are never pruned. */
export const BOARD_SNAPSHOT_KEEP = 24
export const BOARD_SNAPSHOT_INTERVAL_MS = 60 * 60 * 1000

const REASONS: readonly BoardSnapshotReason[] = [
  'hourly',
  'quit',
  'close',
  'manual',
  'closed-board'
]

/** Folder name for a worktree id (ids are paths, so they are hashed, never used raw). */
export function worktreeFolderName(worktreeId: string): string {
  return createHash('sha256').update(worktreeId).digest('hex').slice(0, 32)
}

export function snapshotFileName(takenAt: number, reason: BoardSnapshotReason): string {
  return `${takenAt}-${reason}.json`
}

export function parseSnapshotFileName(
  name: string
): { takenAt: number; reason: BoardSnapshotReason } | null {
  const match = /^(\d{10,16})-([a-z-]+)\.json$/.exec(name)
  if (!match) {
    return null
  }
  const reason = match[2] as BoardSnapshotReason
  return REASONS.includes(reason) ? { takenAt: Number(match[1]), reason } : null
}

/** Autosave file names beyond the newest `keep`, oldest first; these get deleted. */
export function snapshotsToPrune(names: readonly string[], keep = BOARD_SNAPSHOT_KEEP): string[] {
  const parsed = names
    .map((name) => ({ name, info: parseSnapshotFileName(name) }))
    .filter(
      (e): e is { name: string; info: { takenAt: number; reason: BoardSnapshotReason } } =>
        e.info !== null && e.info.reason !== 'closed-board'
    )
    .sort((a, b) => b.info.takenAt - a.info.takenAt)
  return parsed
    .slice(keep)
    .map((e) => e.name)
    .toReversed()
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Card and console counts for the snapshot list preview. */
export function boardCounts(board: unknown): { cards: number; consoles: number } {
  const cards = isObj(board) && Array.isArray(board.cards) ? board.cards : []
  return {
    cards: cards.length,
    consoles: cards.filter((c) => isObj(c) && c.kind === 'console').length
  }
}

/** A board worth saving: it has at least one card. */
export function isSnapshotWorthy(board: unknown): boolean {
  return boardCounts(board).cards > 0
}

/** Stable content key so an unchanged board is not saved again; the camera is ignored. */
export function boardContentKey(board: unknown): string {
  if (!isObj(board)) {
    return ''
  }
  return createHash('sha256')
    .update(JSON.stringify([board.cards ?? null, board.groups ?? null, board.connectors ?? null]))
    .digest('hex')
}

/** Worktree ids whose boards disappeared between two persisted payloads. */
export function removedBoardIds(previous: unknown, next: unknown): string[] {
  if (!isObj(previous)) {
    return []
  }
  const after = isObj(next) ? next : {}
  return Object.keys(previous).filter((id) => !(id in after))
}

export function snapshotMeta(
  worktreeId: string,
  fileName: string,
  board: unknown,
  archived: boolean
): BoardSnapshotMeta | null {
  const info = parseSnapshotFileName(fileName)
  if (!info) {
    return null
  }
  return {
    id: `${archived ? 'archive/' : ''}${fileName}`,
    worktreeId,
    takenAt: info.takenAt,
    reason: info.reason,
    archived,
    ...boardCounts(board)
  }
}
