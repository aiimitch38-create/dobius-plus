import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connect } from './rpc-client'
import { encodeDesktopScreenFrame } from '../../../src/shared/desktop-screen-protocol'
import {
  encodeBrowserScreencastFrame,
  BrowserScreencastOpcode
} from '../../../src/shared/browser-screencast-protocol'
vi.mock('./e2ee', () => ({
  generateKeyPair: () => ({ publicKey: new Uint8Array(32), secretKey: new Uint8Array(32) }),
  deriveSharedKey: () => new Uint8Array(32),
  publicKeyFromBase64: () => new Uint8Array(32),
  publicKeyToBase64: () => 'public',
  encrypt: (text: string) => `encrypted:${text}`,
  decrypt: (text: string) => text.replace(/^encrypted:/, ''),
  decryptBytes: (bytes: Uint8Array) => bytes,
  enableE2EESequencing: () => {},
  isE2EESequenceViolated: () => false
}))
const sockets: Socket[] = []
class Socket {
  static OPEN = 1
  static CONNECTING = 0
  static CLOSED = 3
  readyState = 0
  onopen?: () => void
  onclose?: () => void
  onerror?: () => void
  onmessage?: (event: { data: unknown }) => void
  sent: string[] = []
  constructor() {
    sockets.push(this)
  }
  send(text: string) {
    this.sent.push(text)
  }
  close() {
    this.readyState = 3
    this.onclose?.()
  }
  receive(data: unknown) {
    this.onmessage?.({ data })
  }
  authenticate() {
    this.readyState = 1
    this.onopen?.()
    this.receive(JSON.stringify({ type: 'e2ee_ready' }))
    this.receive('encrypted:{"type":"e2ee_authenticated"}')
  }
  requests(method: string) {
    return this.sent
      .map((text) => JSON.parse(text.replace(/^encrypted:/, '')))
      .filter((request) => request.method === method)
  }
  reply(id: string, result: unknown) {
    this.receive(
      `encrypted:${JSON.stringify({ id, ok: true, streaming: true, result, _meta: { runtimeId: 'host' } })}`
    )
  }
}
const original = globalThis.WebSocket
beforeEach(() => {
  vi.useFakeTimers()
  sockets.length = 0
  globalThis.WebSocket = Socket as unknown as typeof WebSocket
})
afterEach(() => {
  vi.useRealTimers()
  globalThis.WebSocket = original
})
const ready = {
  type: 'ready',
  subscriptionId: '00000000-0000-4000-8000-000000000001',
  generation: '00000000-0000-4000-8000-000000000002',
  displayId: 7,
  width: 1280,
  height: 800
}
const image = new Uint8Array([255, 216, 255, 217])
async function flush() {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve()
  }
}
describe('real phone RPC client desktop integration', () => {
  it('routes concurrent desktop/browser streams independently over the same encrypted channel', async () => {
    const client = connect('ws://host.invalid', 'test-token', 'test-key')
    const socket = sockets[0]
    socket.authenticate()
    const desktop = vi.fn(),
      browser = vi.fn()
    client.subscribe('screen.stream', {}, vi.fn(), { onDesktopFrame: desktop })
    client.subscribe('browser.screencast', {}, vi.fn(), { onBinaryFrame: browser })
    socket.reply(socket.requests('screen.stream')[0].id, ready)
    socket.reply(socket.requests('browser.screencast')[0].id, {
      type: 'ready',
      subscriptionId: 'browser-stream'
    })
    socket.receive(encodeDesktopScreenFrame({ ...ready, sequence: 1, image }))
    await flush()
    expect(desktop).toHaveBeenCalledOnce()
    expect(browser).not.toHaveBeenCalled()
    socket.receive(
      encodeBrowserScreencastFrame({
        opcode: BrowserScreencastOpcode.Frame,
        seq: 1,
        format: 'jpeg',
        metadata: {},
        image
      })
    )
    await flush()
    expect(browser).toHaveBeenCalledOnce()
    expect(desktop).toHaveBeenCalledOnce()
    client.close()
  })
  it('cancels before ready with the correct request and late-ready subscription, never browser cleanup', async () => {
    const client = connect('ws://host.invalid', 'test-token', 'test-key')
    const socket = sockets[0]
    socket.authenticate()
    const desktop = vi.fn()
    const cancel = client.subscribe('screen.stream', {}, vi.fn(), { onDesktopFrame: desktop })
    const request = socket.requests('screen.stream')[0]
    cancel()
    expect(socket.requests('screen.stream.unsubscribe')[0].params).toEqual({
      requestId: request.id
    })
    socket.reply(request.id, ready)
    socket.receive(encodeDesktopScreenFrame({ ...ready, sequence: 1, image }))
    await flush()
    expect(socket.requests('screen.stream.unsubscribe')[1].params).toEqual({
      subscriptionId: ready.subscriptionId,
      generation: ready.generation
    })
    expect(socket.requests('browser.screencast.unsubscribe')).toEqual([])
    expect(desktop).not.toHaveBeenCalled()
    client.close()
  })
  it('never replays viewing after reconnect', () => {
    const client = connect('ws://host.invalid', 'test-token', 'test-key')
    const socket = sockets[0]
    socket.authenticate()
    const event = vi.fn()
    client.subscribe('screen.stream', {}, event)
    socket.reply(socket.requests('screen.stream')[0].id, ready)
    socket.close()
    expect(event).toHaveBeenLastCalledWith({ type: 'end', reason: 'disconnected' })
    vi.advanceTimersByTime(500)
    sockets[1].authenticate()
    expect(sockets[1].requests('screen.stream')).toEqual([])
    client.close()
  })
})
