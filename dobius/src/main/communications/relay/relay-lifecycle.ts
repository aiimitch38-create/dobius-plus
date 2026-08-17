import { join } from 'node:path'
import { app } from 'electron'
import { RelayStore } from './relay-store'
import { startRelayServer } from './relay-server'
import type { RelayServerHandle } from './relay-server'

/**
 * Process-wide relay singleton.
 *
 * Why a singleton: `registerCoreHandlers` runs once per app launch, but the
 * relay owns a bound TCP port and a SQLite handle — starting a second one
 * would just lose the port race against the first.
 */
let started = false
let handle: RelayServerHandle | null = null
let store: RelayStore | null = null

/**
 * Start the local relay that backs Dobius Communications.
 *
 * Why this exists at all: the bundled Buzz client is hardcoded to
 * `http://localhost:3300` / `ws://localhost:3300`
 * (vendor/buzz-desktop/src/shared/api/dobiusCommunications.ts). Without a
 * server on that port every request fails as "Failed to fetch" and the
 * sidebar reads "Can't reach the relay".
 *
 * Fire-and-forget by design: the caller is synchronous IPC registration, and
 * a relay that fails to bind must never block app startup — startRelayServer
 * already resolves (rather than rejects) on EADDRINUSE.
 */
export function startCommunicationsRelay(): void {
  if (started) {
    return
  }
  started = true
  void (async () => {
    try {
      store = new RelayStore(join(app.getPath('userData'), 'relay.db'))
      handle = await startRelayServer({ store })
    } catch (err) {
      // Why swallow: Communications degrading to "can't reach the relay" is a
      // feature outage, not a reason to take the whole app down on launch.
      console.warn(
        '[relay] failed to start:',
        err instanceof Error ? err.message : String(err)
      )
      store?.close()
      store = null
    }
  })()
}

/** Release the port and the SQLite handle. Safe to call when never started. */
export async function stopCommunicationsRelay(): Promise<void> {
  await handle?.close()
  handle = null
  store?.close()
  store = null
  started = false
}
