import { randomUUID } from 'node:crypto'
import { ipcMain, type BrowserWindow } from 'electron'
import { requestRendererReply } from './renderer-reply-request'

export const BOARDS_FLUSH_REQUEST_CHANNEL = 'boards:flushNow'
export const BOARDS_FLUSH_REPLY_CHANNEL = 'boards:flushNowReply'
// ponytail: 2 s cap on holding an update install or relaunch for a board save.
export const BOARDS_FLUSH_BEFORE_EXIT_TIMEOUT_MS = 2_000

type FlushReply = { requestId: string }
type ReplyBus = Parameters<typeof requestRendererReply>[0]['ipc']

/**
 * Asks the Board window to land its pending board write, and resolves on its
 * reply or after the timeout. Why: update install and app:relaunch skip the
 * window-close flow (and its board close guard), so a debounced or queued
 * board write would otherwise die with the renderer. Never rejects.
 */
export async function flushBoardsBeforeExit(
  mainWindow: Pick<BrowserWindow, 'webContents' | 'isDestroyed'>,
  ipc: ReplyBus = ipcMain
): Promise<void> {
  await requestRendererReply<FlushReply | null>({
    ipc,
    mainWindow,
    sendChannel: BOARDS_FLUSH_REQUEST_CHANNEL,
    replyChannel: BOARDS_FLUSH_REPLY_CHANNEL,
    event: { requestId: randomUUID() },
    timeoutMs: BOARDS_FLUSH_BEFORE_EXIT_TIMEOUT_MS,
    parseReply: (raw) =>
      raw && typeof (raw as FlushReply).requestId === 'string' ? (raw as FlushReply) : null,
    failure: () => null
  })
}
