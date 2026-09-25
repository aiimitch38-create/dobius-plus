import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebSocket } from 'ws'
import { enableE2EESequencing } from '../../../shared/e2ee-sequencing'
import { E2EEChannel, type E2EEChannelOptions } from './e2ee-channel'
import { decrypt, deriveSharedKey, encrypt, generateKeyPair } from './e2ee-crypto'

// Why: F5 (in-session replay/reorder) and F1 (single-use pairing token) at
// the channel boundary, with a hand-driven v2 client.
const serverKeys = generateKeyPair()

function openSession(overrides: Partial<E2EEChannelOptions> = {}, sequenceClient = true) {
  const sent: string[] = []
  const ws = { OPEN: 1, readyState: 1, send: vi.fn((data: string) => sent.push(data)) }
  const onReady = vi.fn()
  const onError = vi.fn()
  const channel = new E2EEChannel(ws as unknown as WebSocket, {
    serverSecretKey: serverKeys.secretKey,
    validateToken: (token) => token === 'qr-token' || token === 'phone-token',
    onReady,
    onError,
    ...overrides
  })
  const clientKeys = generateKeyPair()
  const sharedKey = deriveSharedKey(clientKeys.secretKey, serverKeys.publicKey)
  channel.handleRawMessage(
    JSON.stringify({
      type: 'e2ee_hello',
      publicKeyB64: Buffer.from(clientKeys.publicKey).toString('base64')
    })
  )
  const ready = JSON.parse(sent[0]!) as { challenge: string }
  if (sequenceClient) {
    enableE2EESequencing(sharedKey, 'client')
  }
  const authFrame = encrypt(
    JSON.stringify({ type: 'e2ee_auth', deviceToken: 'qr-token', challenge: ready.challenge }),
    sharedKey
  )
  channel.handleRawMessage(authFrame)
  const authReply = sent[1] ? (JSON.parse(decrypt(sent[1], sharedKey)!) as unknown) : null
  return { channel, sent, sharedKey, onReady, onError, authReply, authFrame }
}

describe('E2EEChannel in-session sequencing (F5)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('drops a replayed RPC frame inside the same session', () => {
    const s = openSession()
    const received: string[] = []
    s.channel.onMessage((plaintext) => received.push(plaintext))
    const frame = encrypt('{"id":"1","method":"terminal.send"}', s.sharedKey)
    s.channel.handleRawMessage(frame)
    s.channel.handleRawMessage(frame)
    expect(received).toEqual(['{"id":"1","method":"terminal.send"}'])
    // Round 2 F1: fatal at once, not after the 5-strike decrypt counter.
    expect(s.onError).toHaveBeenCalledWith(4004, 'Out-of-sequence frame')
  })

  it('drops frames delivered out of order', () => {
    const s = openSession()
    const received: string[] = []
    s.channel.onMessage((plaintext) => received.push(plaintext))
    encrypt('{"id":"1"}', s.sharedKey)
    const second = encrypt('{"id":"2"}', s.sharedKey)
    s.channel.handleRawMessage(second)
    expect(received).toEqual([])
    expect(s.onError).toHaveBeenCalledWith(4004, 'Out-of-sequence frame')
  })

  it('drops the auth frame replayed after login', () => {
    const s = openSession()
    const received: string[] = []
    s.channel.onMessage((plaintext) => received.push(plaintext))
    s.channel.handleRawMessage(s.authFrame)
    expect(received).toEqual([])
    expect(s.onError).toHaveBeenCalledWith(4004, 'Out-of-sequence frame')
  })

  it('closes at once when a frame is deleted in transit (round 2 F1)', () => {
    const s = openSession()
    const received: string[] = []
    s.channel.onMessage((plaintext) => received.push(plaintext))
    encrypt('{"id":"dropped"}', s.sharedKey)
    s.channel.handleRawMessage(encrypt('{"id":"after-gap"}', s.sharedKey))
    expect(received).toEqual([])
    expect(s.onError).toHaveBeenCalledWith(4004, 'Out-of-sequence frame')
  })

  it('still tolerates up to 4 frames that fail authentication', () => {
    const s = openSession()
    const stranger = deriveSharedKey(generateKeyPair().secretKey, serverKeys.publicKey)
    for (let i = 0; i < 4; i++) {
      s.channel.handleRawMessage(encrypt('noise', stranger))
    }
    expect(s.onError).not.toHaveBeenCalled()
  })

  it('refuses a v2 auth whose frame is not sequenced', () => {
    const s = openSession({}, false)
    expect(s.onReady).not.toHaveBeenCalled()
    expect(s.onError).toHaveBeenCalledWith(4001, 'Unsequenced e2ee_auth')
  })
})

describe('E2EEChannel single-use pairing token (F1)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('hands the replacement token to the client and binds the session to it', () => {
    const s = openSession({ claimToken: (token) => (token === 'qr-token' ? 'phone-token' : null) })
    expect(s.authReply).toEqual({ type: 'e2ee_authenticated', deviceToken: 'phone-token' })
    expect(s.channel.deviceToken).toBe('phone-token')
    expect(s.onReady).toHaveBeenCalledTimes(1)
  })

  it('sends no token when the login did not consume an offer', () => {
    const s = openSession({ claimToken: () => null })
    expect(s.authReply).toEqual({ type: 'e2ee_authenticated' })
    expect(s.channel.deviceToken).toBe('qr-token')
  })

  it('fails the login if the swap cannot be saved', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const s = openSession({
      claimToken: () => {
        throw new Error('EACCES')
      }
    })
    errorSpy.mockRestore()
    expect(s.onReady).not.toHaveBeenCalled()
    expect(s.onError).toHaveBeenCalledWith(4001, 'Unauthorized')
    expect(s.authReply).toMatchObject({ type: 'e2ee_error', error: { code: 'unauthorized' } })
  })
})
