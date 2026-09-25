import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connect } from './rpc-client'

const e2eeSpies = vi.hoisted(() => ({ enableE2EESequencing: vi.fn() }))

const e2eeViolation = vi.hoisted(() => ({ value: false }))

vi.mock('./e2ee', () => ({
  generateKeyPair: () => ({
    publicKey: new Uint8Array(32),
    secretKey: new Uint8Array(32)
  }),
  deriveSharedKey: () => new Uint8Array(32),
  publicKeyFromBase64: () => new Uint8Array(32),
  publicKeyToBase64: () => 'client-public-key',
  encrypt: (plaintext: string) => `encrypted:${plaintext}`,
  decrypt: (raw: string) => (raw === 'undecryptable' ? null : raw.replace(/^encrypted:/, '')),
  decryptBytes: (bytes: Uint8Array) => bytes,
  enableE2EESequencing: e2eeSpies.enableE2EESequencing,
  isE2EESequenceViolated: () => e2eeViolation.value
}))

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readonly CONNECTING = MockWebSocket.CONNECTING
  readonly OPEN = MockWebSocket.OPEN
  readonly CLOSING = MockWebSocket.CLOSING
  readonly CLOSED = MockWebSocket.CLOSED

  readyState = MockWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  emitCloseOnClose = true
  sent: string[] = []
  close = vi.fn(() => {
    if (this.readyState === MockWebSocket.CLOSED) {
      return
    }
    this.readyState = MockWebSocket.CLOSED
    if (this.emitCloseOnClose) {
      this.onclose?.()
    }
  })

  constructor(readonly endpoint: string) {
    mockSockets.push(this)
  }

  send(payload: string): void {
    this.sent.push(payload)
  }

  open(): void {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }

  receive(payload: unknown): void {
    this.onmessage?.({ data: payload })
  }
}

const mockSockets: MockWebSocket[] = []
const originalWebSocket = globalThis.WebSocket

describe('mobile rpc-client handshake v2 (#17, F1, F5)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockSockets.length = 0
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.WebSocket = originalWebSocket
  })

  it('echoes the handshake v2 challenge and numbers its frames (#17, F5)', () => {
    e2eeSpies.enableE2EESequencing.mockClear()
    const client = connect('ws://desktop.invalid', 'token', 'server-key')
    const socket = mockSockets[0]!

    socket.open()
    socket.receive(JSON.stringify({ type: 'e2ee_ready', version: 2, challenge: 'fresh-challenge' }))

    expect(socket.sent.at(-1)).toBe(
      `encrypted:${JSON.stringify({ type: 'e2ee_auth', deviceToken: 'token', challenge: 'fresh-challenge' })}`
    )
    expect(e2eeSpies.enableE2EESequencing).toHaveBeenCalledWith(expect.any(Uint8Array), 'client')
    client.close()
  })

  it('still authenticates to an older desktop that sends no challenge', () => {
    e2eeSpies.enableE2EESequencing.mockClear()
    const client = connect('ws://desktop.invalid', 'token', 'server-key')
    const socket = mockSockets[0]!

    socket.open()
    socket.receive(JSON.stringify({ type: 'e2ee_ready' }))

    expect(socket.sent.at(-1)).toBe(
      `encrypted:${JSON.stringify({ type: 'e2ee_auth', deviceToken: 'token' })}`
    )
    expect(e2eeSpies.enableE2EESequencing).not.toHaveBeenCalled()
    client.close()
  })

  it('adopts and reports the token the desktop issues for a used pairing QR (F1)', async () => {
    const rotated: string[] = []
    const client = connect('ws://desktop.invalid', 'qr-token', 'server-key', {
      onDeviceTokenRotated: (token) => rotated.push(token)
    })
    const socket = mockSockets[0]!

    socket.open()
    socket.receive(JSON.stringify({ type: 'e2ee_ready', version: 2, challenge: 'c' }))
    socket.receive('encrypted:{"type":"e2ee_authenticated","deviceToken":"phone-token"}')

    expect(client.getState()).toBe('connected')
    expect(rotated).toEqual(['phone-token'])
    expect(client.getDeviceToken()).toBe('phone-token')
    void client.sendRequest('status.get').catch(() => {})
    await vi.advanceTimersByTimeAsync(0)
    expect(socket.sent.some((frame) => frame.includes('"deviceToken":"phone-token"'))).toBe(true)
    expect(socket.sent.slice(2).some((frame) => frame.includes('qr-token'))).toBe(false)
    client.close()
  })

  it('shows "Update the Dobius+ app" when a newer desktop rejects this app', () => {
    const client = connect('ws://desktop.invalid', 'token', 'server-key')
    const socket = mockSockets[0]!

    socket.open()
    socket.receive(JSON.stringify({ type: 'e2ee_ready', version: 3, challenge: 'c' }))
    socket.receive(
      'encrypted:{"type":"e2ee_error","error":{"code":"client_update_required","message":"old"}}'
    )

    expect(client.getState()).toBe('update-required')
    // No auth retry loop: the socket is closed and nothing reconnects.
    vi.advanceTimersByTime(60_000)
    expect(mockSockets).toHaveLength(1)
    client.close()
  })

  it('retries instead of latching when update_required follows a stripped v1 ready (round 2 F2)', () => {
    const client = connect('ws://desktop.invalid', 'token', 'server-key')
    const socket = mockSockets[0]!

    socket.open()
    socket.receive(JSON.stringify({ type: 'e2ee_ready' }))
    socket.receive(
      'encrypted:{"type":"e2ee_error","error":{"code":"client_update_required","message":"old"}}'
    )

    expect(client.getState()).not.toBe('update-required')
    expect(socket.close).toHaveBeenCalled()
    vi.advanceTimersByTime(1_000)
    expect(mockSockets.length).toBeGreaterThan(1)
    client.close()
  })

  it('drops and reconnects the socket on an out-of-sequence frame (round 2 F1)', () => {
    const client = connect('ws://desktop.invalid', 'token', 'server-key')
    const socket = mockSockets[0]!
    socket.open()
    socket.receive(JSON.stringify({ type: 'e2ee_ready', version: 2, challenge: 'c' }))
    socket.receive('encrypted:{"type":"e2ee_authenticated"}')
    expect(client.getState()).toBe('connected')

    socket.receive('undecryptable')
    expect(socket.close).not.toHaveBeenCalled()

    e2eeViolation.value = true
    try {
      socket.receive('undecryptable')
    } finally {
      e2eeViolation.value = false
    }
    expect(socket.close).toHaveBeenCalledTimes(1)
    expect(client.getState()).toBe('reconnecting')
    vi.advanceTimersByTime(1_000)
    expect(mockSockets.length).toBeGreaterThan(1)
    client.close()
  })

  it('reads binary frames as ArrayBuffer so they decrypt in arrival order', () => {
    const client = connect('ws://desktop.invalid', 'token', 'server-key')
    expect((mockSockets[0] as unknown as { binaryType?: string }).binaryType).toBe('arraybuffer')
    client.close()
  })
})
