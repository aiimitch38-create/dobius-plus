import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebRuntimeClient } from './web-runtime-client'
import {
  deriveSharedKey,
  encrypt,
  encryptBytes,
  generateKeyPair
} from '../../../shared/e2ee-crypto'
import { enableE2EESequencing } from '../../../shared/e2ee-sequencing'

// Why: round 2 F1 — an authentic frame out of sequence (replayed, reordered
// or a frame deleted on the path) must drop the socket so the client
// reconnects with fresh keys, instead of silently skipping it.
function connectedClient() {
  vi.stubGlobal('window', {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    atob: (value: string) => Buffer.from(value, 'base64').toString('binary'),
    btoa: (value: string) => Buffer.from(value, 'binary').toString('base64')
  })
  const server = generateKeyPair()
  const clientKeys = generateKeyPair()
  const clientKey = deriveSharedKey(clientKeys.secretKey, server.publicKey)
  const serverKey = deriveSharedKey(server.secretKey, clientKeys.publicKey)
  enableE2EESequencing(clientKey, 'client')
  enableE2EESequencing(serverKey, 'server')
  const client = new WebRuntimeClient({
    v: 2,
    endpoint: 'ws://127.0.0.1:6768',
    deviceToken: 'token',
    publicKeyB64: Buffer.from(server.publicKey).toString('base64')
  })
  const socket = { close: vi.fn(), readyState: 1 }
  const internals = client as unknown as {
    state: string
    ws: unknown
    sharedKey: Uint8Array
    handleSocketMessage: (rawData: unknown) => Promise<void>
  }
  internals.state = 'connected'
  internals.ws = socket
  internals.sharedKey = clientKey
  return { client, internals, socket, serverKey, clientKeys, server }
}

describe('WebRuntimeClient frame sequencing', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', class {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('drops the socket when a text frame arrives after a deleted one', async () => {
    const { internals, socket, serverKey } = connectedClient()
    encrypt('{"_keepalive":true}', serverKey)
    await internals.handleSocketMessage(encrypt('{"_keepalive":true}', serverKey))
    expect(socket.close).toHaveBeenCalledTimes(1)
  })

  it('drops the socket on a replayed binary frame', async () => {
    const { internals, socket, serverKey } = connectedClient()
    const frame = encryptBytes(new Uint8Array([1, 2, 3]), serverKey)
    await internals.handleSocketMessage(frame)
    expect(socket.close).not.toHaveBeenCalled()
    await internals.handleSocketMessage(frame)
    expect(socket.close).toHaveBeenCalledTimes(1)
  })

  it('keeps the socket for a frame that merely fails to decrypt', async () => {
    const { internals, socket } = connectedClient()
    const stranger = deriveSharedKey(generateKeyPair().secretKey, generateKeyPair().publicKey)
    await internals.handleSocketMessage(encrypt('noise', stranger))
    expect(socket.close).not.toHaveBeenCalled()
  })
})
