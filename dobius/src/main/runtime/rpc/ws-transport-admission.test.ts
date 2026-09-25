import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { WebSocketTransport } from './ws-transport'

// Mirrors MAX_WS_CONNECTIONS in ws-transport.ts.
const SLOT_CAP = 128

describe('WebSocketTransport slot admission (#20)', () => {
  const transports: WebSocketTransport[] = []
  const sockets: WebSocket[] = []

  afterEach(async () => {
    for (const ws of sockets) {
      ws.terminate()
    }
    sockets.length = 0
    await Promise.all(transports.map((t) => t.stop()))
    transports.length = 0
  })

  async function startTransport(): Promise<WebSocketTransport> {
    // Why: port 0 = ephemeral port; a long pre-auth timeout keeps the idle
    // sockets alive so only the slot policy can remove them.
    const transport = new WebSocketTransport({
      host: '127.0.0.1',
      port: 0,
      preAuthTimeoutMs: 60_000
    })
    transport.onMessage(() => {})
    transports.push(transport)
    await transport.start()
    return transport
  }

  function connect(transport: WebSocketTransport): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${transport.resolvedPort}`)
      sockets.push(ws)
      ws.once('open', () => resolve(ws))
      ws.once('error', reject)
    })
  }

  function serverSockets(transport: WebSocketTransport): WebSocket[] {
    const wss = (transport as unknown as { wss: { clients: Set<WebSocket> } }).wss
    return Array.from(wss.clients)
  }

  function closeCode(ws: WebSocket, timeoutMs = 1_000): Promise<number | 'open'> {
    return new Promise((resolve) => {
      if (ws.readyState === ws.CLOSED) {
        resolve(1006)
        return
      }
      const timer = setTimeout(() => resolve('open'), timeoutMs)
      ws.once('close', (code) => {
        clearTimeout(timer)
        resolve(code)
      })
    })
  }

  async function waitFor(predicate: () => boolean): Promise<void> {
    const start = Date.now()
    while (!predicate() && Date.now() - start < 2_000) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  it('evicts the oldest idle pre-auth socket instead of refusing a new client', async () => {
    const transport = await startTransport()
    const oldest = await connect(transport)
    await Promise.all(Array.from({ length: SLOT_CAP - 1 }, () => connect(transport)))
    await waitFor(() => serverSockets(transport).length === SLOT_CAP)

    const newcomer = await connect(transport)
    const oldestClosed = closeCode(oldest)
    const newcomerState = closeCode(newcomer, 300)

    expect(await oldestClosed).not.toBe('open')
    expect(await newcomerState).toBe('open')
    await waitFor(() => serverSockets(transport).length === SLOT_CAP)
    expect(serverSockets(transport).length).toBe(SLOT_CAP)
  }, 15_000)

  it('never displaces an authenticated client, even under a pre-auth flood', async () => {
    const transport = await startTransport()
    const phone = await connect(transport)
    await waitFor(() => serverSockets(transport).length === 1)
    transport.setClientId(serverSockets(transport)[0]!, 'phone-token')

    await Promise.all(Array.from({ length: SLOT_CAP + 20 }, () => connect(transport)))
    const phoneState = closeCode(phone, 300)
    expect(await phoneState).toBe('open')

    // Why: the phone can still open another socket while the flood holds slots.
    const phoneSecondSocket = await connect(transport)
    expect(await closeCode(phoneSecondSocket, 300)).toBe('open')
  }, 15_000)

  it('refuses a new client with 1013 when every slot is authenticated', async () => {
    const transport = await startTransport()
    await Promise.all(Array.from({ length: SLOT_CAP }, () => connect(transport)))
    await waitFor(() => serverSockets(transport).length === SLOT_CAP)
    for (const ws of serverSockets(transport)) {
      transport.setClientId(ws, 'device-token')
    }

    const extra = await connect(transport)
    expect(await closeCode(extra)).toBe(1013)
    await waitFor(() => serverSockets(transport).length === SLOT_CAP)
    expect(serverSockets(transport).length).toBe(SLOT_CAP)
  }, 15_000)
})
