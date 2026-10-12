import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import {
  decrypt,
  deriveSharedKey,
  encrypt,
  generateKeyPair,
  publicKeyToBase64
} from './e2ee-crypto'
import { enableE2EESequencing } from './e2ee-sequencing'
import { sendRemoteRuntimeRequest } from './remote-runtime-client'
import { RemoteRuntimeRequestConnection } from './remote-runtime-request-connection'

// Why: round 2 F1 — the shared desktop/CLI clients must treat an authentic
// frame that skips a counter (a frame deleted on the path) as fatal.
const serverKeys = generateKeyPair()
const servers: WebSocketServer[] = []

afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))))
  servers.length = 0
})

// A v2 server that answers every request but drops one frame before the reply.
async function gappyServer(): Promise<string> {
  const wss = new WebSocketServer({ port: 0 })
  servers.push(wss)
  wss.on('connection', (socket) => {
    // Why: send with a sequenced key; read the client's frames with an
    // unsequenced copy (this mock does not police the client's counters).
    let sendKey: Uint8Array | null = null
    let readKey: Uint8Array | null = null
    let authed = false
    socket.on('message', (data) => {
      const raw = data.toString()
      if (!sendKey || !readKey) {
        const hello = JSON.parse(raw) as { publicKeyB64: string }
        sendKey = deriveSharedKey(serverKeys.secretKey, Buffer.from(hello.publicKeyB64, 'base64'))
        readKey = new Uint8Array(sendKey)
        enableE2EESequencing(sendKey, 'server')
        socket.send(JSON.stringify({ type: 'e2ee_ready', version: 2, challenge: 'c' }))
        return
      }
      const message = JSON.parse(decrypt(raw, readKey)!) as { id?: string }
      if (!authed) {
        authed = true
        socket.send(encrypt(JSON.stringify({ type: 'e2ee_authenticated' }), sendKey))
        return
      }
      encrypt('{"deleted":true}', sendKey)
      socket.send(encrypt(JSON.stringify({ id: message.id, ok: true, result: {} }), sendKey))
    })
  })
  await new Promise<void>((resolve) => wss.once('listening', resolve))
  const address = wss.address()
  if (!address || typeof address !== 'object') {
    throw new Error('no address')
  }
  return `ws://127.0.0.1:${address.port}`
}

function pairing(endpoint: string) {
  return {
    v: 2 as const,
    endpoint,
    deviceToken: 'tok',
    publicKeyB64: publicKeyToBase64(serverKeys.publicKey)
  }
}

describe('shared remote runtime clients: out-of-sequence frames', () => {
  it('one-shot request fails on a gap', async () => {
    const endpoint = await gappyServer()
    await expect(
      sendRemoteRuntimeRequest(pairing(endpoint), 'status.get', {}, 3_000)
    ).rejects.toThrow(/undecryptable/)
  })

  it('persistent request connection closes on a gap', async () => {
    const endpoint = await gappyServer()
    const connection = new RemoteRuntimeRequestConnection(pairing(endpoint))
    await expect(connection.request('status.get', {}, 3_000)).rejects.toThrow(/undecryptable/)
    connection.close()
  })
})
