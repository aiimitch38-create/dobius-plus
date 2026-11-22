// `dobius board snapshots list|read|capture`: the autosaved copies of a
// worktree's Board (main/board-snapshots). Restoring stays in the Board window
// (it merges a snapshot into the live board without touching terminals).
import { z } from 'zod'
import type { BoardSnapshotFile, BoardSnapshotMeta } from '../../../../shared/board-snapshot-types'
import { CliActionError } from '../../../../shared/cli-action-errors'
import { getActiveBoardSnapshotService } from '../../../board-snapshots/board-snapshot-active'
import type { BoardSnapshotService } from '../../../board-snapshots/board-snapshot-service'
import { defineMethod, type RpcMethod } from '../core'

// Why capped: archived boards of every removed workspace are listed too and never pruned.
export const BOARD_SNAPSHOT_LIST_MAX = 200

const WorktreeSelector = z
  .unknown()
  .transform((v) => (typeof v === 'string' ? v : ''))
  .pipe(z.string().min(1, 'Missing worktree selector'))

const ListParams = z.object({ worktree: WorktreeSelector })
const ReadParams = z.object({
  worktree: WorktreeSelector,
  id: z.string().trim().min(1, 'Missing snapshot id').max(200, 'snapshot id is too long'),
  /** The snapshot's own worktreeId from the list, for an archived board of a removed workspace. */
  source: z.string().trim().min(1).max(4096).optional()
})

function service(): BoardSnapshotService {
  const active = getActiveBoardSnapshotService()
  if (!active) {
    throw new CliActionError('board_snapshot_unavailable', 'Board snapshots are not running in this app.')
  }
  return active
}

export type BoardSnapshotListResult = {
  worktreeId: string
  snapshots: BoardSnapshotMeta[]
  totalCount: number
  truncated: boolean
}

export const BOARD_SNAPSHOT_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'board.snapshotList',
    params: ListParams,
    handler: async (params, { runtime }): Promise<BoardSnapshotListResult> => {
      const worktree = await runtime.showManagedWorktree(params.worktree)
      const all = service().list(worktree.id)
      return {
        worktreeId: worktree.id,
        snapshots: all.slice(0, BOARD_SNAPSHOT_LIST_MAX),
        totalCount: all.length,
        truncated: all.length > BOARD_SNAPSHOT_LIST_MAX
      }
    }
  }),
  defineMethod({
    name: 'board.snapshotRead',
    params: ReadParams,
    handler: async (params, { runtime }): Promise<BoardSnapshotFile> => {
      const worktree = await runtime.showManagedWorktree(params.worktree)
      const snapshots = service()
      let owner = worktree.id
      if (params.source && params.source !== worktree.id) {
        // Why only a listed archive: `source` is caller text; it may only name
        // a closed board this worktree's list already shows, never any folder.
        const listed = snapshots
          .list(worktree.id)
          .some((m) => m.archived && m.worktreeId === params.source && m.id === params.id)
        if (!listed) {
          throw new CliActionError(
            'board_snapshot_not_found',
            `no archived snapshot "${params.id}" from ${params.source} in this list.`
          )
        }
        owner = params.source
      }
      const file = snapshots.read(owner, params.id)
      if (!file) {
        throw new CliActionError(
          'board_snapshot_not_found',
          `no snapshot "${params.id}". Run \`dobius board snapshots list\` for ids.`
        )
      }
      return file
    }
  }),
  defineMethod({
    name: 'board.snapshotCapture',
    params: ListParams,
    handler: async (params, { runtime }) => {
      const worktree = await runtime.showManagedWorktree(params.worktree)
      const boards = runtime.getUIState().boardsByWorktree as unknown
      const board =
        typeof boards === 'object' && boards !== null
          ? (boards as Record<string, unknown>)[worktree.id]
          : undefined
      const captured = service().capture(worktree.id, board, 'manual', { skipUnchanged: true })
      return {
        worktreeId: worktree.id,
        captured,
        ...(captured
          ? {}
          : { reason: 'The Board is empty or has not changed since its last snapshot.' })
      }
    }
  })
]
