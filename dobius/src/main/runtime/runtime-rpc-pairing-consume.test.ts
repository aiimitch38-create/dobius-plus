import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { parsePairingCode } from '../../shared/pairing'
import { enableE2EESequencing } from '../../shared/e2ee-sequencing'
import { DobiusRuntimeService } from './dobius-runtime'
import { decrypt, deriveSharedKey, encrypt, generateKeyPair } from './rpc/e2ee-crypto'
import { DobiusRuntimeRpcServer } from './runtime-rpc'

vi.mock('../git/worktree', () => ({
  listWorktrees: vi.fn().mockResolvedValue([]),
  listWorktreesStrict: vi.fn().mockResolvedValue([])
}))

type AuthReply = { type: string; deviceToken?: string; error?: { code?: string } }

function nextMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(data.toString('utf-8')))
  })
}

// Why: real server, real sockets on an ephemeral port — the client side of
// handshake v2 done by hand so the test controls which token is presented.
async function login(pairingUrl: string, token: string): Promise<AuthReply> {
  const offer = parsePairingCode(pairingUrl)!
  const ws = await new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(offer.endpoint)
    socket.once('open', () => resolve(socket))
    socket.once('error', reject)
  })
  try {
    const keys = generateKeyPair()
    const sharedKey = deriveSharedKey(
      keys.secretKey,
      Uint8Array.from(Buffer.from(offer.publicKeyB64, 'base64'))
    )
    ws.send(
      JSON.stringify({
        type: 'e2ee_hello',
        publicKeyB64: Buffer.from(keys.publicKey).toString('base64')
      })
    )
    const ready = JSON.parse(await nextMessage(ws)) as { challenge: string }
    enableE2EESequencing(sharedKey, 'client')
    ws.send(
      encrypt(
        JSON.stringify({ type: 'e2ee_auth', deviceToken: token, challenge: ready.challenge }),
        sharedKey
      )
    )
    return JSON.parse(decrypt(await nextMessage(ws), sharedKey)!) as AuthReply
  } finally {
    ws.close()
  }
}

describe('single-use mobile pairing QR (F1)', () => {
  it('swaps the QR token on first login and retires it once the phone uses its own', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'dobius-pairing-consume-'))
    const server = new DobiusRuntimeRpcServer({
      runtime: new DobiusRuntimeService(),
      userDataPath,
      enableWebSocket: true,
      wsPort: 0
    })
    await server.start()
    try {
      const offer = server.createPairingOffer({ address: '127.0.0.1', scope: 'mobile' })
      if (!offer.available) {
        throw new Error('pairing unavailable')
      }
      const qrToken = parsePairingCode(offer.pairingUrl)!.deviceToken

      const first = await login(offer.pairingUrl, qrToken)
      expect(first.type).toBe('e2ee_authenticated')
      expect(first.deviceToken).toMatch(/^[0-9a-f]{48}$/)
      expect(first.deviceToken).not.toBe(qrToken)

      // Grace window: the phone lost its token and rescans the same QR.
      const rescan = await login(offer.pairingUrl, qrToken)
      expect(rescan.type).toBe('e2ee_authenticated')
      expect(rescan.deviceToken).not.toBe(first.deviceToken)

      // A later connection with the phone's own token retires the QR at once.
      const phone = await login(offer.pairingUrl, rescan.deviceToken!)
      expect(phone).toEqual({ type: 'e2ee_authenticated' })

      const replayedQr = await login(offer.pairingUrl, qrToken)
      expect(replayedQr).toMatchObject({ type: 'e2ee_error', error: { code: 'unauthorized' } })

      // The paired phone is listed and a new QR carries a new token.
      expect(server.getDeviceRegistry()!.getDevice(offer.deviceId)!.lastSeenAt).toBeGreaterThan(0)
      const next = server.createPairingOffer({ address: '127.0.0.1', scope: 'mobile' })
      expect(next.available && next.deviceId).not.toBe(offer.deviceId)
    } finally {
      await server.stop()
    }
  }, 15_000)

  it('keeps runtime link tokens (shared by parallel CLI and desktop sockets)', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'dobius-pairing-consume-'))
    const server = new DobiusRuntimeRpcServer({
      runtime: new DobiusRuntimeService(),
      userDataPath,
      enableWebSocket: true,
      wsPort: 0
    })
    await server.start()
    try {
      const offer = server.createPairingOffer({ address: '127.0.0.1', scope: 'runtime' })
      if (!offer.available) {
        throw new Error('pairing unavailable')
      }
      const token = parsePairingCode(offer.pairingUrl)!.deviceToken
      expect(await login(offer.pairingUrl, token)).toEqual({ type: 'e2ee_authenticated' })
      expect(await login(offer.pairingUrl, token)).toEqual({ type: 'e2ee_authenticated' })
    } finally {
      await server.stop()
    }
  }, 15_000)
})
