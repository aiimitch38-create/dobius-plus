import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: {} }))

import {
  BOARDS_FLUSH_BEFORE_EXIT_TIMEOUT_MS,
  BOARDS_FLUSH_REPLY_CHANNEL,
  BOARDS_FLUSH_REQUEST_CHANNEL,
  flushBoardsBeforeExit
} from './flush-renderer-boards'
import { resetRendererReplyRequestsForTest } from './renderer-reply-request'

const bus = new EventEmitter()
const mainFrame = {}
const webContents = { send: vi.fn(), mainFrame }
const mainWindow = { webContents, isDestroyed: () => false } as never

function reply(requestId: unknown): void {
  bus.emit(BOARDS_FLUSH_REPLY_CHANNEL, { sender: webContents, senderFrame: mainFrame }, { requestId })
}

beforeEach(() => {
  vi.useFakeTimers()
  webContents.send.mockClear()
  resetRendererReplyRequestsForTest()
})

afterEach(() => {
  vi.useRealTimers()
  bus.removeAllListeners()
})

describe('flushBoardsBeforeExit', () => {
  it('resolves when the Board window replies to this request', async () => {
    let done = false
    const flushed = flushBoardsBeforeExit(mainWindow, bus).then(() => (done = true))
    expect(webContents.send).toHaveBeenCalledWith(BOARDS_FLUSH_REQUEST_CHANNEL, {
      requestId: expect.any(String)
    })
    reply('another-request')
    await Promise.resolve()
    expect(done).toBe(false)

    reply(webContents.send.mock.calls[0][1].requestId)
    await flushed
    expect(done).toBe(true)
    expect(bus.listenerCount(BOARDS_FLUSH_REPLY_CHANNEL)).toBe(0)
  })

  it('resolves after the timeout when the window never replies', async () => {
    let done = false
    const flushed = flushBoardsBeforeExit(mainWindow, bus).then(() => (done = true))
    await vi.advanceTimersByTimeAsync(BOARDS_FLUSH_BEFORE_EXIT_TIMEOUT_MS - 1)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await flushed
    expect(done).toBe(true)
    expect(bus.listenerCount(BOARDS_FLUSH_REPLY_CHANNEL)).toBe(0)
  })

  it('resolves at once when the window is gone', async () => {
    await flushBoardsBeforeExit({ webContents, isDestroyed: () => true } as never, bus)
    expect(webContents.send).not.toHaveBeenCalled()
  })
})
