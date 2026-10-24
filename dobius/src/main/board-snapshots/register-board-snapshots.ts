import { join } from 'node:path'
import { app, ipcMain } from 'electron'
import type { Store } from '../persistence'
import { getUserDataRoot } from '../storage/user-data-root'
import type { BoardSnapshotMeta, BoardSnapshotFile } from '../../shared/board-snapshot-types'
import { BOARD_SNAPSHOT_INTERVAL_MS } from './board-snapshot-rules'
import { BoardSnapshotService } from './board-snapshot-service'

// Board snapshots run in main from the persisted UI payload: hourly, on quit,
// when the renderer leaves the Board, and an archive copy when a board
// disappears (its workspace was removed). Restoring happens in the renderer,
// which merges a snapshot into the live board without touching terminals.

let registered = false

const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0

export function registerBoardSnapshotHandlers(store: Store): void {
  if (registered) {
    return
  }
  registered = true
  const service = new BoardSnapshotService(join(getUserDataRoot(), 'board-snapshots'))
  const boards = (): unknown => store.getUI().boardsByWorktree

  let previous = boards()
  store.onUIChanged((ui) => {
    const next = ui.boardsByWorktree
    if (next !== previous) {
      service.archiveRemoved(previous, next)
      previous = next
    }
  })

  const timer = setInterval(
    () => service.captureAll(boards(), 'hourly'),
    BOARD_SNAPSHOT_INTERVAL_MS
  )
  timer.unref?.()
  app.on('before-quit', () => {
    clearInterval(timer)
    service.captureAll(boards(), 'quit')
  })

  ipcMain.handle(
    'boardSnapshots:list',
    (_event, args: { worktreeId?: unknown }): BoardSnapshotMeta[] =>
      isString(args?.worktreeId) ? service.list(args.worktreeId) : []
  )
  ipcMain.handle(
    'boardSnapshots:read',
    (_event, args: { worktreeId?: unknown; id?: unknown }): BoardSnapshotFile | null =>
      isString(args?.worktreeId) && isString(args?.id)
        ? service.read(args.worktreeId, args.id)
        : null
  )
  ipcMain.handle(
    'boardSnapshots:capture',
    (_event, args: { worktreeId?: unknown; reason?: unknown }): boolean => {
      if (!isString(args?.worktreeId)) {
        return false
      }
      const all = boards()
      const board =
        typeof all === 'object' && all !== null
          ? (all as Record<string, unknown>)[args.worktreeId]
          : undefined
      return service.capture(args.worktreeId, board, args.reason === 'close' ? 'close' : 'manual')
    }
  )
}
