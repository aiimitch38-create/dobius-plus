import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebSocket } from 'ws'
import { E2EEChannel } from './e2ee-channel'
import { decrypt, deriveSharedKey, encrypt, generateKeyPair } from './e2ee-crypto'
import { enableE2EESequencing } from '../../../shared/e2ee-sequencing'

// Why: #17 — a passive LAN sniffer must not be able to replay a captured
// handshake on a fresh socket and become the paired phone.

type MockWs = { OPEN: 1; readyState: number; send: ReturnType<typeof vi.fn>; sent: string[] }

function mockWs(): MockWs {
  const sent: string[] = []
  return { OPEN: 1, readyState: 1, send: vi.fn((data: string) => sent.push(data)), sent }
}

const serverKeys = generateKeyPair()

function openChannel() {
  const ws = mockWs()
  const onReady = vi.fn()
  const onError = vi.fn()
  const channel = new E2EEChannel(ws as unknown as WebSocket, {
    serverSecretKey: serverKeys.secretKey,
    validateToken: (token) => token === 'device-token',
    onReady,
    onError
  })
  return { channel, ws, onReady, onError }
}

describe('E2EEChannel replay protection (#17)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects a captured hello + auth replayed on a new connection', () => {
    const phoneKeys = generateKeyPair()
    const sharedKey = deriveSharedKey(phoneKeys.secretKey, serverKeys.publicKey)
    enableE2EESequencing(sharedKey, 'client')
    const hello = JSON.stringify({
      type: 'e2ee_hello',
      publicKeyB64: Buffer.from(phoneKeys.publicKey).toString('base64')
    })

    // The phone's real session, as seen on the wire by an attacker.
    const first = openChannel()
    first.channel.handleRawMessage(hello)
    const ready = JSON.parse(first.ws.sent[0]!) as { challenge: string }
    const capturedAuth = encrypt(
      JSON.stringify({
        type: 'e2ee_auth',
        deviceToken: 'device-token',
        challenge: ready.challenge
      }),
      sharedKey
    )
    first.channel.handleRawMessage(capturedAuth)
    expect(first.onReady).toHaveBeenCalledTimes(1)

    // The attacker replays both frames byte-for-byte on a new socket.
    const replay = openChannel()
    replay.channel.handleRawMessage(hello)
    replay.channel.handleRawMessage(capturedAuth)

    expect(replay.onReady).not.toHaveBeenCalled()
    expect(replay.channel.deviceToken).toBeNull()
    expect(replay.onError).toHaveBeenCalledWith(4001, 'Stale e2ee_auth')
  })

  it('issues a different challenge on every connection', () => {
    const phoneKeys = generateKeyPair()
    const hello = JSON.stringify({
      type: 'e2ee_hello',
      publicKeyB64: Buffer.from(phoneKeys.publicKey).toString('base64')
    })
    const a = openChannel()
    const b = openChannel()
    a.channel.handleRawMessage(hello)
    b.channel.handleRawMessage(hello)
    const challengeA = (JSON.parse(a.ws.sent[0]!) as { challenge: string }).challenge
    const challengeB = (JSON.parse(b.ws.sent[0]!) as { challenge: string }).challenge
    expect(Buffer.from(challengeA, 'base64')).toHaveLength(32)
    expect(challengeA).not.toBe(challengeB)
  })

  it('tells a pre-v2 client to update instead of failing silently', () => {
    const phoneKeys = generateKeyPair()
    const sharedKey = deriveSharedKey(phoneKeys.secretKey, serverKeys.publicKey)
    const ctx = openChannel()
    ctx.channel.handleRawMessage(
      JSON.stringify({
        type: 'e2ee_hello',
        publicKeyB64: Buffer.from(phoneKeys.publicKey).toString('base64')
      })
    )
    // Old clients send a valid token but no challenge.
    ctx.channel.handleRawMessage(
      encrypt(JSON.stringify({ type: 'e2ee_auth', deviceToken: 'device-token' }), sharedKey)
    )

    expect(ctx.onReady).not.toHaveBeenCalled()
    expect(ctx.onError).toHaveBeenCalledWith(4010, 'Client update required')
    const errorFrame = JSON.parse(decrypt(ctx.ws.sent[1]!, sharedKey)!) as {
      type: string
      error: { code: string; message: string }
    }
    expect(errorFrame.type).toBe('e2ee_error')
    expect(errorFrame.error.code).toBe('client_update_required')
    expect(errorFrame.error.message).toMatch(/update/i)
  })

  it('rejects a non-string challenge without throwing', () => {
    const phoneKeys = generateKeyPair()
    const sharedKey = deriveSharedKey(phoneKeys.secretKey, serverKeys.publicKey)
    enableE2EESequencing(sharedKey, 'client')
    const ctx = openChannel()
    ctx.channel.handleRawMessage(
      JSON.stringify({
        type: 'e2ee_hello',
        publicKeyB64: Buffer.from(phoneKeys.publicKey).toString('base64')
      })
    )
    ctx.channel.handleRawMessage(
      encrypt(
        JSON.stringify({ type: 'e2ee_auth', deviceToken: 'device-token', challenge: 42 }),
        sharedKey
      )
    )
    expect(ctx.onReady).not.toHaveBeenCalled()
    expect(ctx.onError).toHaveBeenCalledWith(4001, 'Stale e2ee_auth')
  })
})
