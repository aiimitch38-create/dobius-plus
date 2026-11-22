// Main asks the Board window to do something and waits for its answer
// (`dobius board restart|rename|note|close`, `dobius tabs snooze`). Same shape
// as the `board.open-tile` request: send on one channel, take the reply that
// carries our requestId on another, from the window's top frame only.
import type { BrowserWindow, IpcMainEvent } from 'electron'

type ReplyBus = {
  on(channel: string, listener: (event: IpcMainEvent, reply: unknown) => void): unknown
  removeListener(channel: string, listener: (event: IpcMainEvent, reply: unknown) => void): unknown
}

export type RendererReplyRequestOptions<Reply> = {
  ipc: ReplyBus
  mainWindow: Pick<BrowserWindow, 'webContents' | 'isDestroyed'>
  sendChannel: string
  replyChannel: string
  event: { requestId: string }
  timeoutMs: number
  /** The reply, or null when it is malformed (it is then ignored). */
  parseReply: (raw: unknown) => Reply | null
  /** What the caller gets when the window is gone, busy or does not answer. */
  failure: (reason: 'timeout' | 'unavailable' | 'busy') => Reply
}

// Why bounded: every request holds one listener until it settles or times out
// (and under 10, so ipcMain never warns about a listener leak).
export const MAX_PENDING_RENDERER_REQUESTS = 8
let pending = 0

export function requestRendererReply<Reply>(
  options: RendererReplyRequestOptions<Reply>
): Promise<Reply> {
  const { ipc, mainWindow, event } = options
  if (mainWindow.isDestroyed()) {
    return Promise.resolve(options.failure('unavailable'))
  }
  if (pending >= MAX_PENDING_RENDERER_REQUESTS) {
    return Promise.resolve(options.failure('busy'))
  }
  pending += 1
  return new Promise<Reply>((resolve) => {
    let settled = false
    const finish = (reply: Reply): void => {
      if (settled) {
        return
      }
      settled = true
      pending -= 1
      clearTimeout(timer)
      ipc.removeListener(options.replyChannel, handler)
      resolve(reply)
    }
    const handler = (ipcEvent: IpcMainEvent, raw: unknown): void => {
      // Why: requestId is echoed by the renderer; only the targeted window's
      // top frame (never a web tile guest or sub-frame) may answer for it.
      if (
        ipcEvent.sender !== mainWindow.webContents ||
        ipcEvent.senderFrame !== mainWindow.webContents.mainFrame
      ) {
        return
      }
      const reply = options.parseReply(raw)
      if (!reply || (reply as { requestId?: unknown }).requestId !== event.requestId) {
        return
      }
      finish(reply)
    }
    const timer = setTimeout(() => finish(options.failure('timeout')), options.timeoutMs)
    ipc.on(options.replyChannel, handler)
    try {
      mainWindow.webContents.send(options.sendChannel, event)
    } catch {
      finish(options.failure('unavailable'))
    }
  })
}

export function resetRendererReplyRequestsForTest(): void {
  pending = 0
}
