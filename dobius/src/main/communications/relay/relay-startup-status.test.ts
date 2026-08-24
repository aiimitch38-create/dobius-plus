import { afterEach, describe, expect, it } from 'vitest'
import { RelayStore } from './relay-store'
import { startRelayServer, type RelayServerHandle } from './relay-server'
import {
  getRelayStartupStatus,
  recordRelayBindFailure,
  recordRelayRunning,
  recordRelayStartError,
  recordRelayStarting,
  recordRelayStopped,
  relayBindFailureReason
} from './relay-startup-status'

/**
 * The status store is a module singleton, so every case normalizes with
 * recordRelayStopped() first and the sequence below stays order-explicit.
 * Server handles bind port 0 (ephemeral) — never RELAY_PORT, which the
 * developer's own running Dobius+ may hold (see relay-server.test.ts).
 */
const openServers: RelayServerHandle[] = []
const openStores: RelayStore[] = []

afterEach(async () => {
  for (const handle of openServers.splice(0)) {
    await handle.close()
  }
  for (const store of openStores.splice(0)) {
    store.close()
  }
})

describe('relay startup status recording', () => {
  it('starts from stopped and walks the success path', () => {
    recordRelayStopped()
    expect(getRelayStartupStatus()).toEqual({ state: 'stopped' })

    recordRelayStarting()
    expect(getRelayStartupStatus()).toEqual({ state: 'starting' })

    recordRelayRunning(3300)
    expect(getRelayStartupStatus()).toEqual({ state: 'running', port: 3300 })

    recordRelayStopped()
    expect(getRelayStartupStatus()).toEqual({ state: 'stopped' })
  })

  it('records a bind failure with a plain-language reason and port', () => {
    recordRelayStopped()
    recordRelayBindFailure('port 3300 is already in use', 3300)
    expect(getRelayStartupStatus()).toEqual({
      state: 'failed',
      reason: 'Port 3300 is held by another process',
      port: 3300
    })
  })

  it('records a non-bind start failure with the underlying message', () => {
    recordRelayStopped()
    recordRelayStartError('database is locked')
    expect(getRelayStartupStatus()).toEqual({
      state: 'failed',
      reason: 'Relay could not start: database is locked'
    })
  })

  it('maps bind errors to user-facing reasons', () => {
    expect(relayBindFailureReason('port 3300 is already in use', 3300)).toBe(
      'Port 3300 is held by another process'
    )
    expect(relayBindFailureReason('permission denied', 4100)).toBe(
      'Relay could not bind port 4100: permission denied'
    )
  })
})

describe('relay server handle reports a refused bind', () => {
  it('marks the second bind of a held port as unbound and keeps close() safe', async () => {
    const firstStore = new RelayStore(':memory:')
    openStores.push(firstStore)
    const first = await startRelayServer({ store: firstStore, port: 0, host: '127.0.0.1' })
    openServers.push(first)
    expect(first.bound).toBe(true)
    expect(first.bindError).toBeUndefined()

    const secondStore = new RelayStore(':memory:')
    openStores.push(secondStore)
    const second = await startRelayServer({ store: secondStore, port: first.port, host: '127.0.0.1' })
    expect(second.bound).toBe(false)
    expect(second.bindError).toBe(`port ${first.port} is already in use`)
    // An inert handle must still be safe to close (the swallow-don't-throw contract).
    await expect(second.close()).resolves.toBeUndefined()
  })
})
