import { join } from 'node:path'
import { app, ipcMain } from 'electron'
import {
  COMMUNICATIONS_RELAY_STATUS_CHANNEL,
  type CommunicationsRelayStatus
} from '../../../shared/communications-relay-status'
import { RelayStore } from './relay-store'
import {
  getRelayStartupStatus,
  recordRelayBindFailure,
  recordRelayRunning,
  recordRelayStartError,
  recordRelayStarting,
  recordRelayStopped
} from './relay-startup-status'
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
 * already resolves (rather than rejects) on EADDRINUSE. The failure reason is
 * still recorded (relay-startup-status) so the UI can show WHY instead of a
 * bare "can't reach the relay".
 */
export function startCommunicationsRelay(): void {
  if (started) {
    return
  }
  started = true
  recordRelayStarting()
  void (async () => {
    try {
      store = new RelayStore(join(app.getPath('userData'), 'relay.db'))
      handle = await startRelayServer({ store })
    } catch (err) {
      // Why swallow: Communications degrading to "can't reach the relay" is a
      // feature outage, not a reason to take the whole app down on launch.
      const message = err instanceof Error ? err.message : String(err)
      console.warn('[relay] failed to start:', message)
      recordRelayStartError(message)
      store?.close()
      store = null
      return
    }
    if (handle.bound) {
      recordRelayRunning(handle.port)
    } else {
      recordRelayBindFailure(handle.bindError ?? 'unknown bind failure', handle.port)
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
  recordRelayStopped()
}

/**
 * Read-only status read for the Communications renderer's connection card.
 *
 * Why its own channel: it is an app-health read owned by main, not a runtime
 * command, so it stays outside the communications-bridge allowlist.
 */
export function registerRelayStatusHandler(): void {
  ipcMain.removeHandler(COMMUNICATIONS_RELAY_STATUS_CHANNEL)
  ipcMain.handle(
    COMMUNICATIONS_RELAY_STATUS_CHANNEL,
    (): CommunicationsRelayStatus => getRelayStartupStatus()
  )
}
