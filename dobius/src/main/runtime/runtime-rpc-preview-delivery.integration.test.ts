import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { DobiusRuntimeService } from './dobius-runtime'
import { DobiusRuntimeRpcServer } from './runtime-rpc'
import { ApplicationDataCatalog } from '../storage/data-catalog/application-catalog'
import { parsePairingCode } from '../../shared/pairing'
import { decrypt, deriveSharedKey, encrypt, generateKeyPair } from './rpc/e2ee-crypto'
import { enableE2EESequencing } from '../../shared/e2ee-sequencing'
import { emitCatalogPreviewInvalidated } from './rpc/data-catalog-preview-invalidation'

vi.mock('../git/worktree', () => ({
  listWorktrees: vi.fn().mockResolvedValue([]),
  listWorktreesStrict: vi.fn().mockResolvedValue([])
}))

function nextMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Synthetic transport timed out')), 2_000)
    const onMessage = (message: WebSocket.RawData): void => finish(null, message.toString())
    const onError = (error: Error): void => finish(error)
    function finish(error: Error | null, result = ''): void {
      clearTimeout(timer)
      ws.off('message', onMessage)
      ws.off('error', onError)
      if (error) {
        reject(error)
      } else {
        resolve(result)
      }
    }
    ws.once('message', onMessage)
    ws.once('error', onError)
  })
}

async function connect(pairingUrl: string, token?: string) {
  const pairing = parsePairingCode(pairingUrl)
  if (!pairing) {
    throw new Error('Invalid synthetic pairing offer')
  }
  const ws = new WebSocket(pairing.endpoint)
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  const keys = generateKeyPair()
  const key = deriveSharedKey(
    keys.secretKey,
    Uint8Array.from(Buffer.from(pairing.publicKeyB64, 'base64'))
  )
  const readyMessage = nextMessage(ws)
  ws.send(
    JSON.stringify({
      type: 'e2ee_hello',
      publicKeyB64: Buffer.from(keys.publicKey).toString('base64')
    })
  )
  const ready = JSON.parse(await readyMessage)
  expect(ready.type).toBe('e2ee_ready')
  expect(ready.version).toBe(2)
  enableE2EESequencing(key, 'client')
  const authMessage = nextMessage(ws)
  ws.send(
    encrypt(
      JSON.stringify({
        type: 'e2ee_auth',
        deviceToken: token ?? pairing.deviceToken,
        challenge: ready.challenge
      }),
      key
    )
  )
  const authenticated = JSON.parse(decrypt(await authMessage, key)!)
  expect(authenticated.type).toBe('e2ee_authenticated')
  const messages: unknown[] = []
  const listener = (raw: WebSocket.RawData): void => {
    const plain = decrypt(raw.toString(), key)
    if (plain !== null) {
      messages.push(JSON.parse(plain))
    }
  }
  ws.on('message', listener)
  return {
    ws,
    messages,
    token: authenticated.deviceToken ?? token ?? pairing.deviceToken,
    request(id: string, params: unknown) {
      ws.send(encrypt(JSON.stringify({ id, method: 'data.catalog.preview.policy', params }), key))
    },
    dispose() {
      ws.off('message', listener)
      ws.close()
    }
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = performance.now() + 2_000
  while (!predicate()) {
    if (performance.now() >= deadline) {
      throw new Error('Synthetic transport condition timed out')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('real encrypted catalog preview invalidation transport', () => {
  it('targets one of two authenticated connections for the same phone and removes closed routes', async () => {
    const base = await mkdtemp(join(tmpdir(), 'dobius-preview-delivery-'))
    const connections: string[] = []
    const catalog = new ApplicationDataCatalog({
      registryPath: join(base, 'roots.json'),
      pairedDevices: () => [],
      chooseDirectory: async () => null
    })
    // Observe the server-owned principal at the dispatch boundary; native content is tested separately.
    vi.spyOn(catalog, 'previewPolicy').mockImplementation(async (principal) => {
      connections.push(principal.connectionId)
      return { state: 'mobile', enabled: false } as const
    })
    const server = new DobiusRuntimeRpcServer({
      runtime: new DobiusRuntimeService(),
      userDataPath: base,
      enableWebSocket: true,
      wsPort: 0,
      dataCatalog: catalog
    })
    const sessions: Awaited<ReturnType<typeof connect>>[] = []
    const event = {
      rootId: 'fixture-root',
      generation: '11111111-1111-4111-8111-111111111111',
      reason: 'revoked' as const
    }
    try {
      await server.start()
      const offer = server.createPairingOffer({
        address: '127.0.0.1',
        name: 'Fixture phone',
        scope: 'mobile'
      })
      if (!offer.available) {
        throw new Error('Synthetic WebSocket pairing unavailable')
      }
      const first = await connect(offer.pairingUrl)
      sessions.push(first)
      const second = await connect(offer.pairingUrl, first.token)
      sessions.push(second)
      const request = { rootId: event.rootId, generation: event.generation }
      first.request('fixture-first', request)
      await waitFor(() => first.messages.length === 1)
      second.request('fixture-second', request)
      await waitFor(() => second.messages.length === 1)
      expect(connections).toHaveLength(2)
      expect(connections[0]).not.toBe(connections[1])
      expect(emitCatalogPreviewInvalidated(connections[0]!, { ...event, path: '/private' })).toBe(
        false
      )
      expect(emitCatalogPreviewInvalidated(connections[0]!, event)).toBe(true)
      await waitFor(() => first.messages.length === 2)
      expect(first.messages[1]).toEqual(event)
      expect(second.messages).toHaveLength(1)
      first.dispose()
      await waitFor(() => server['wsConnectionIds'].size === 1)
      expect(emitCatalogPreviewInvalidated(connections[0]!, event)).toBe(false)
      expect(emitCatalogPreviewInvalidated(connections[1]!, event)).toBe(true)
      await waitFor(() => second.messages.length === 2)
      expect(second.messages[1]).toEqual(event)
      await server.stop()
      expect(emitCatalogPreviewInvalidated(connections[1]!, event)).toBe(false)
    } finally {
      for (const session of sessions) {
        session.dispose()
      }
      await server.stop()
      await catalog.close()
      await rm(base, { force: true, recursive: true })
    }
  }, 15_000)
})
