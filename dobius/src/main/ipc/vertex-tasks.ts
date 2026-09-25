/* IPC surface for Vertex-owned tasks (the Kanban board).
 *
 * Distinct from the existing Tasks surface, which reads issues out of GitHub /
 * GitLab / Linear / Jira. Here Vertex owns the record; external systems are
 * optional sync targets and none are called from this file.
 *
 * Every handler validates its arguments at the boundary and returns null or
 * false rather than throwing, so a malformed renderer call degrades to "that
 * did not happen" instead of an unhandled rejection in the main process. */

import { ipcMain, webContents } from 'electron'

import { reloadVertexTasksFromDisk, vertexTaskStore } from '../vertex/vertex-task-store'
import { withClaimingWindow, withLostClaimCheck } from '../vertex/vertex-dispatch-recovery'
import {
  isVertexTaskStatus,
  type VertexTask,
  type VertexTaskInput,
  type VertexTaskPatch,
} from '../../shared/vertex-task-types'

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function registerVertexTaskHandlers(): void {
  ipcMain.removeHandler('vertexTasks:list')
  ipcMain.handle('vertexTasks:list', async (): Promise<VertexTask[]> => vertexTaskStore.list())

  ipcMain.removeHandler('vertexTasks:reload')
  ipcMain.handle('vertexTasks:reload', async (): Promise<VertexTask[]> => reloadVertexTasksFromDisk())

  ipcMain.removeHandler('vertexTasks:create')
  ipcMain.handle(
    'vertexTasks:create',
    async (_event, input: VertexTaskInput): Promise<VertexTask | null> => {
      if (!input || !isNonEmptyString(input.title)) {
        return null
      }
      try {
        return vertexTaskStore.create(input)
      } catch {
        return null
      }
    },
  )

  ipcMain.removeHandler('vertexTasks:update')
  ipcMain.handle(
    'vertexTasks:update',
    async (
      event,
      args: { taskId: string; patch: VertexTaskPatch },
    ): Promise<VertexTask | null> => {
      if (!args || !isNonEmptyString(args.taskId) || !args.patch) {
        return null
      }
      return withClaimingWindow(event.sender.id, () =>
        vertexTaskStore.update(args.taskId, args.patch),
      )
    },
  )

  // Why: a window's board dispatcher calls this on every poll. Claims it made
  // before a reload, or whose settle write failed, have no promise left to
  // settle them; they are ended as interrupted, never relaunched.
  ipcMain.removeHandler('vertexTasks:releaseInterruptedClaims')
  ipcMain.handle(
    'vertexTasks:releaseInterruptedClaims',
    async (event, args: { activeTaskIds: string[] }): Promise<void> => {
      if (
        !args ||
        !Array.isArray(args.activeTaskIds) ||
        !args.activeTaskIds.every(isNonEmptyString)
      ) {
        return
      }
      const check = {
        webContentsId: event.sender.id,
        activeTaskIds: new Set(args.activeTaskIds),
        isWebContentsLive: (id: number) => {
          const contents = webContents.fromId(id)
          return Boolean(contents && !contents.isDestroyed() && !contents.isCrashed())
        },
      }
      withLostClaimCheck(check, () => vertexTaskStore.list())
    },
  )

  ipcMain.removeHandler('vertexTasks:move')
  ipcMain.handle(
    'vertexTasks:move',
    async (
      _event,
      args: { taskId: string; to: string; toIndex: number },
    ): Promise<VertexTask | null> => {
      if (!args || !isNonEmptyString(args.taskId) || !isVertexTaskStatus(args.to)) {
        return null
      }
      const toIndex = Number.isFinite(args.toIndex) ? Math.trunc(args.toIndex) : 0
      return vertexTaskStore.move(args.taskId, args.to, toIndex)
    },
  )

  ipcMain.removeHandler('vertexTasks:remove')
  ipcMain.handle('vertexTasks:remove', async (_event, taskId: string): Promise<boolean> => {
    if (!isNonEmptyString(taskId)) {
      return false
    }
    return vertexTaskStore.remove(taskId)
  })
}
