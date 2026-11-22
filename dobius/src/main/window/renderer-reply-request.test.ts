import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainEvent } from 'electron'
import {
  MAX_PENDING_RENDERER_REQUESTS,
  requestRendererReply,
  resetRendererReplyRequestsForTest
} from './renderer-reply-request'

type Reply = { requestId: string; ok: boolean; why?: string }

function setup() {
  const ipc = new EventEmitter()
  const mainFrame = { id: 'main-frame' }
  const webContents = { send: vi.fn(), mainFrame }
  const mainWindow = { webContents, isDestroyed: () => false }
  const request = (requestId: string, timeoutMs = 1000) =>
    requestRendererReply<Reply>({
      ipc: ipc as never,
      mainWindow: mainWindow as never,
      sendChannel: 'ui:x',
      replyChannel: 'x:reply',
      event: { requestId },
      timeoutMs,
      parseReply: (raw) => raw as Reply,
      failure: (why) => ({ requestId, ok: false, why })
    })
  const reply = (sender: unknown, senderFrame: unknown, body: Reply) =>
    ipc.emit('x:reply', { sender, senderFrame } as unknown as IpcMainEvent, body)
  return { ipc, webContents, mainFrame, request, reply }
}

afterEach(() => {
  vi.useRealTimers()
  resetRendererReplyRequestsForTest()
})

describe('requestRendererReply', () => {
  it('resolves with the reply for its requestId from the window top frame only', async () => {
    const { ipc, webContents, mainFrame, request, reply } = setup()
    const pending = request('r1')
    expect(webContents.send).toHaveBeenCalledWith('ui:x', { requestId: 'r1' })
    reply({ other: true }, mainFrame, { requestId: 'r1', ok: true })
    reply(webContents, { id: 'sub-frame' }, { requestId: 'r1', ok: true })
    reply(webContents, mainFrame, { requestId: 'r2', ok: true })
    reply(webContents, mainFrame, { requestId: 'r1', ok: true, why: 'real' })
    await expect(pending).resolves.toEqual({ requestId: 'r1', ok: true, why: 'real' })
    expect(ipc.listenerCount('x:reply')).toBe(0)
  })

  it('times out with the failure reply and removes its listener', async () => {
    vi.useFakeTimers()
    const { ipc, request } = setup()
    const pending = request('r1', 50)
    vi.advanceTimersByTime(60)
    await expect(pending).resolves.toEqual({ requestId: 'r1', ok: false, why: 'timeout' })
    expect(ipc.listenerCount('x:reply')).toBe(0)
  })

  it('refuses new requests past the pending cap', async () => {
    vi.useFakeTimers()
    const { request } = setup()
    const held = Array.from({ length: MAX_PENDING_RENDERER_REQUESTS }, (_, i) => request(`r${i}`, 50))
    await expect(request('one-too-many')).resolves.toEqual({
      requestId: 'one-too-many',
      ok: false,
      why: 'busy'
    })
    vi.advanceTimersByTime(60)
    await Promise.all(held)
  })
})
