/**
 * Starts a REAL in-process Dobius relay (the same `RelayStore` +
 * `startRelayServer` the packaged app uses) for the communications
 * verification harness to drive "relay"-disposition commands against.
 *
 * Why port 3300 and not an ephemeral port (unlike relay-server.test.ts, which
 * deliberately always binds port 0): the vendored Buzz client hardcodes
 * `http://localhost:3300` / `ws://localhost:3300` in
 * `vendor/buzz-desktop/src/shared/api/dobiusCommunications.ts`
 * (`DOBIUS_RELAY_HTTP_URL` / `DOBIUS_RELAY_WEBSOCKET_URL`). That file is
 * vendored and out of scope to edit, so the harness has no way to point the
 * client at a different port — it must bind the same one the real app uses.
 *
 * Why the preflight check: if a real Dobius+ instance is already running on
 * this machine, it already holds port 3300. `startRelayServer` swallows a
 * failed bind and returns an inert handle rather than throwing (by design —
 * see relay-server.ts), so silently "starting" in that situation would mean
 * every relay command in this run actually talks to the developer's live
 * relay and writes real channels/messages into it. This module refuses to
 * do that: it probes the port first and only starts an isolated in-memory
 * relay when the port is genuinely free.
 */
import net from 'node:net'
import { RelayStore } from '../relay/relay-store'
import { startRelayServer, type RelayServerHandle } from '../relay/relay-server'
import { RELAY_HOST, RELAY_PORT } from '../relay/relay-types'

export type RelayHarness =
  | { available: true; store: RelayStore; handle: RelayServerHandle; port: number }
  | { available: false; reason: string }

/** Resolves true if something is already accepting connections on host:port. */
function isPortTaken(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    const finish = (taken: boolean): void => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(taken)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(500, () => finish(false))
  })
}

/**
 * Starts an isolated, in-memory relay bound to RELAY_HOST:RELAY_PORT (3300),
 * the same address the vendored Buzz client hardcodes. Refuses to start if
 * the port is already taken (see module doc) — callers must treat
 * `available: false` as "skip every relay-disposition command this run."
 */
export async function startVerificationRelay(): Promise<RelayHarness> {
  if (await isPortTaken(RELAY_HOST, RELAY_PORT)) {
    return {
      available: false,
      reason:
        `port ${RELAY_PORT} on ${RELAY_HOST} is already in use — likely a real ` +
        `Dobius+ instance. Refusing to run relay-disposition commands against ` +
        `what may be live production relay data.`
    }
  }

  const store = new RelayStore(':memory:')
  const handle = await startRelayServer({ store, port: RELAY_PORT, host: RELAY_HOST })

  // startRelayServer never rejects; on a failed bind it returns the
  // requested port back with a no-op close(), which is indistinguishable
  // from success by `port` alone when binding a fixed (non-zero) port. Prove
  // the server is really ours with a real round-trip instead of trusting
  // the return value.
  const isOurs = await verifyOwnRelay(store)
  if (!isOurs) {
    await handle.close()
    store.close()
    return {
      available: false,
      reason: `relay failed to bind ${RELAY_HOST}:${RELAY_PORT} (see console warnings above)`
    }
  }

  return { available: true, store, handle, port: handle.port }
}

/**
 * Inserts a uniquely-tagged marker event directly into `store` (bypassing
 * HTTP) and confirms the same marker is retrievable via a real `POST /query`
 * against RELAY_HOST:RELAY_PORT. Only our own listen() call could serve a
 * marker only our own in-memory store holds, so a hit proves the HTTP server
 * answering on that port is backed by the store we just created — not some
 * other process that won the bind race.
 */
async function verifyOwnRelay(store: RelayStore): Promise<boolean> {
  const marker = `dobius-comms-verify-${process.pid}-${Date.now()}`
  const event = {
    id: marker.padEnd(64, '0').slice(0, 64),
    pubkey: '0'.repeat(64),
    created_at: Math.floor(Date.now() / 1000),
    kind: 30078,
    tags: [['d', marker]],
    content: '',
    sig: '0'.repeat(128)
  }
  store.insert(event)

  try {
    const response = await fetch(`http://${RELAY_HOST}:${RELAY_PORT}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ ids: [event.id] }])
    })
    if (!response.ok) {return false}
    const results = (await response.json()) as { id: string }[]
    return results.some((candidate) => candidate.id === event.id)
  } catch {
    return false
  }
}

export async function stopVerificationRelay(harness: RelayHarness): Promise<void> {
  if (!harness.available) {return}
  await harness.handle.close()
  harness.store.close()
}
