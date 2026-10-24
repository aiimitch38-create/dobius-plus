// Board snapshots: autosaved copies of a worktree's board under
// <userData>/board-snapshots/<hashed worktree id>/, plus an archive folder of
// boards that were closed (their workspace removed) that is never pruned.

export type BoardSnapshotReason = 'hourly' | 'quit' | 'close' | 'manual' | 'closed-board'

export type BoardSnapshotMeta = {
  /** Relative id inside the worktree's snapshot folder ("<file>" or "archive/<file>"). */
  id: string
  worktreeId: string
  takenAt: number
  reason: BoardSnapshotReason
  archived: boolean
  cards: number
  consoles: number
}

export type BoardSnapshotFile = {
  version: 1
  worktreeId: string
  takenAt: number
  reason: BoardSnapshotReason
  board: unknown
}
