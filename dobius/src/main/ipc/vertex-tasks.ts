/* IPC surface for Vertex-owned tasks (the Kanban board).
 *
 * Distinct from the existing Tasks surface, which reads issues out of GitHub /
 * GitLab / Linear / Jira. Here Vertex owns the record; external systems are
 * optional sync targets and none are called from this file.
 *
 * Every handler validates its arguments at the boundary and returns null or
 * false rather than throwing, so a malformed renderer call degrades to "that
 * did not happen" instead of an unhandled rejection in the main process. */

import { BrowserWindow, ipcMain, webContents } from 'electron'

import { reloadVertexTasksFromDisk, vertexTaskStore } from '../vertex/vertex-task-store'
import {
  addVertexTaskAttachment,
  readVertexTaskAttachment,
} from '../vertex/vertex-task-attachments'
import { withClaimingWindow, withLostClaimCheck } from '../vertex/vertex-dispatch-recovery'
import {
  isVertexTaskStatus,
  type VertexTask,
  type VertexTaskAttachment,
  type VertexTaskAttachmentInput,
  type VertexTaskInput,
  type VertexTaskOpResult,
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
      } catch (error) {
        console.error('[vertex-tasks] create failed', error)
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
      // Why: attachment records carry file paths; only addAttachment writes them.
      delete args.patch.attachments
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

  ipcMain.removeHandler('vertexTasks:addAttachment')
  ipcMain.handle(
    'vertexTasks:addAttachment',
    async (
      _event,
      args: { taskId: string; input: VertexTaskAttachmentInput },
    ): Promise<VertexTaskAttachment | null> => {
      if (!args || !isNonEmptyString(args.taskId) || !args.input) {
        return null
      }
      try {
        return addVertexTaskAttachment(args.taskId, args.input)
      } catch (err) {
        console.warn('[vertex] addAttachment refused:', err)
        return null
      }
    },
  )

  ipcMain.removeHandler('vertexTasks:readAttachment')
  ipcMain.handle(
    'vertexTasks:readAttachment',
    async (_event, args: { taskId: string; attachmentId: string }): Promise<string | null> => {
      if (!args || !isNonEmptyString(args.taskId) || !isNonEmptyString(args.attachmentId)) {
        return null
      }
      return readVertexTaskAttachment(args.taskId, args.attachmentId)
    },
  )

  // Why: the report dialog hides itself first, so the shot shows the bug and
  // not the form; the renderer owns that timing and only asks for the pixels.
  ipcMain.removeHandler('vertexTasks:captureWindow')
  ipcMain.handle('vertexTasks:captureWindow', async (event): Promise<string | null> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || window.isDestroyed()) {
      return null
    }
    try {
      const image = await window.webContents.capturePage()
      return image.isEmpty() ? null : image.toPNG().toString('base64')
    } catch (err) {
      console.warn('[vertex] captureWindow failed:', err)
      return null
    }
  })

  // Work-board operations (leads / workers normally reach these through the
  // `dobius tasks` RPC; the UI gets the same store methods for operator use).
  ipcMain.removeHandler('vertexTasks:claim')
  ipcMain.handle(
    'vertexTasks:claim',
    async (
      _event,
      args: { taskId: string; by: string; kind: 'lead' | 'worker'; leaseMs?: number },
    ): Promise<VertexTaskOpResult | null> => {
      if (!args || !isNonEmptyString(args.taskId) || !isNonEmptyString(args.by)) {
        return null
      }
      return vertexTaskStore.claim(args.taskId, {
        by: args.by,
        kind: args.kind === 'lead' ? 'lead' : 'worker',
        leaseMs: typeof args.leaseMs === 'number' ? args.leaseMs : undefined,
      })
    },
  )

  ipcMain.removeHandler('vertexTasks:heartbeat')
  ipcMain.handle(
    'vertexTasks:heartbeat',
    async (
      _event,
      args: { taskId: string; by: string; note?: string },
    ): Promise<VertexTaskOpResult | null> => {
      if (!args || !isNonEmptyString(args.taskId) || !isNonEmptyString(args.by)) {
        return null
      }
      return vertexTaskStore.heartbeat(
        args.taskId,
        args.by,
        typeof args.note === 'string' ? args.note : undefined,
      )
    },
  )

  ipcMain.removeHandler('vertexTasks:complete')
  ipcMain.handle(
    'vertexTasks:complete',
    async (
      _event,
      args: {
        taskId: string
        by: string
        resultNote: string
        metadata?: Record<string, unknown>
        force?: boolean
      },
    ): Promise<VertexTaskOpResult | null> => {
      if (
        !args ||
        !isNonEmptyString(args.taskId) ||
        !isNonEmptyString(args.by) ||
        !isNonEmptyString(args.resultNote)
      ) {
        return null
      }
      return vertexTaskStore.complete(args.taskId, {
        by: args.by,
        resultNote: args.resultNote,
        metadata:
          args.metadata && typeof args.metadata === 'object' && !Array.isArray(args.metadata)
            ? args.metadata
            : undefined,
        force: args.force === true,
      })
    },
  )

  ipcMain.removeHandler('vertexTasks:block')
  ipcMain.handle(
    'vertexTasks:block',
    async (
      _event,
      args: { taskId: string; by: string; reason: string },
    ): Promise<VertexTaskOpResult | null> => {
      if (
        !args ||
        !isNonEmptyString(args.taskId) ||
        !isNonEmptyString(args.by) ||
        !isNonEmptyString(args.reason)
      ) {
        return null
      }
      return vertexTaskStore.block(args.taskId, args.by, args.reason)
    },
  )

  ipcMain.removeHandler('vertexTasks:release')
  ipcMain.handle(
    'vertexTasks:release',
    async (_event, args: { taskId: string; by: string }): Promise<VertexTaskOpResult | null> => {
      if (!args || !isNonEmptyString(args.taskId) || !isNonEmptyString(args.by)) {
        return null
      }
      return vertexTaskStore.release(args.taskId, args.by)
    },
  )

  ipcMain.removeHandler('vertexTasks:comment')
  ipcMain.handle(
    'vertexTasks:comment',
    async (
      _event,
      args: { taskId: string; author: string; body: string },
    ): Promise<VertexTask | null> => {
      if (
        !args ||
        !isNonEmptyString(args.taskId) ||
        !isNonEmptyString(args.author) ||
        !isNonEmptyString(args.body)
      ) {
        return null
      }
      return vertexTaskStore.comment(args.taskId, args.author, args.body)
    },
  )
}
