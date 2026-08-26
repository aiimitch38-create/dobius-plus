// One-time cutover import of the Buzz webview's Nostr identity into the
// native participant identity store. The vendored client kept its signing
// key in the 'persist:dobius-communications' partition's localStorage under
// 'dobius-buzz-identity.v1' (see vendor/buzz-desktop/src/main.tsx); after the
// native-client cutover, channels and DMs addressed to that old pubkey stay
// visible only if the SAME key becomes the participant identity
// (participant-identity-store.ts). The legacy key is renamed with a
// '-migrated' suffix afterwards so a later sign-out can never resurrect it,
// and so this migration never re-runs.
//
// Startup contract mirrors relay-lifecycle.ts: fire-and-forget, at most one
// warning line per failure mode, never blocks or fails app startup. Key
// material is never logged — warnings carry error messages only.
import { BrowserWindow, session } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DOBIUS_COMMUNICATIONS_PARTITION } from '../../shared/communications-bridge'
import {
  hasParticipantIdentity,
  importParticipantPrivateKey,
  onParticipantIdentityCreated,
  signParticipantEvent
} from './participant-identity-store'
import { submitRelayEvent } from './identity/relay-http-client'
import { getRelayStartupStatus } from './relay/relay-startup-status'

const LEGACY_IDENTITY_KEY = 'dobius-buzz-identity.v1'
const MIGRATED_IDENTITY_KEY = `${LEGACY_IDENTITY_KEY}-migrated`
const KIND_PROFILE_METADATA = 0

const GUEST_LOAD_TIMEOUT_MS = 10_000
const RELAY_READY_TIMEOUT_MS = 10_000
const RELAY_READY_POLL_MS = 200

export type MigrationOutcome =
  | 'migrated'
  | 'skipped-existing-identity'
  | 'skipped-already-migrated'
  | 'skipped-no-legacy-identity'
  | 'failed-invalid-json'
  | 'failed-storage-read'
  | 'skipped-repeat-call'

type LegacyStorageSnapshot = { current: string | null; migrated: string | null }

let attempted = false

/**
 * Runs the migration once per process. Registers the fresh-creation profile
 * publisher either way, then imports the vendored client's localStorage
 * identity when the participant store is still empty. Never rejects.
 */
export async function runCommunicationsBuzzIdentityMigration(): Promise<MigrationOutcome> {
  if (attempted) {
    return 'skipped-repeat-call'
  }
  attempted = true

  // Why register before importing: a fresh identity generated anywhere else
  // (first-run ensure, post-sign-out regenerate) must still get a kind-0
  // profile so peers see a username instead of a truncated pubkey.
  onParticipantIdentityCreated((identity) => {
    void publishKind0Profile(identity.username, 'fresh')
  })

  try {
    return await withTimeout(migrateLegacyIdentity(), GUEST_LOAD_TIMEOUT_MS, 'legacy identity read timed out')
  } catch (err) {
    console.warn(`[communications] buzz identity migration skipped: ${errorMessage(err)}`)
    return 'failed-storage-read'
  }
}

async function migrateLegacyIdentity(): Promise<MigrationOutcome> {
  if (hasParticipantIdentity()) {
    return 'skipped-existing-identity'
  }

  const guest = openPartitionGuest()
  try {
    await guest.webContents.loadURL(buildCommunicationsGuestEntryUrl())
    const snapshot = (await guest.webContents.executeJavaScript(
      `({ current: window.localStorage.getItem(${JSON.stringify(LEGACY_IDENTITY_KEY)}), migrated: window.localStorage.getItem(${JSON.stringify(MIGRATED_IDENTITY_KEY)}) })`
    )) as LegacyStorageSnapshot

    if (!snapshot.current) {
      return snapshot.migrated ? 'skipped-already-migrated' : 'skipped-no-legacy-identity'
    }

    const legacy = parseLegacyIdentity(snapshot.current)
    if (!legacy) {
      console.warn('[communications] buzz identity migration skipped: stored identity JSON is invalid')
      await flagKeyMigrated(guest.webContents)
      return 'failed-invalid-json'
    }

    const imported = importParticipantPrivateKey(legacy.privateKeyHex, legacy.username)
    await flagKeyMigrated(guest.webContents)
    void publishKind0Profile(imported.username, 'migrated')
    return 'migrated'
  } finally {
    guest.destroy()
  }
}

// BrowserWindow (public, typed) instead of the undocumented webContents.create/.destroy()
// internals — Electron 42's own .d.ts dropped their type declarations.
function openPartitionGuest(): BrowserWindow {
  session.fromPartition(DOBIUS_COMMUNICATIONS_PARTITION)
  return new BrowserWindow({
    show: false,
    webPreferences: { partition: DOBIUS_COMMUNICATIONS_PARTITION }
  })
}

function buildCommunicationsGuestEntryUrl(): string {
  // The probe only needs to land ON the legacy partition's localStorage
  // origin, not on any specific page: for http: URLs localStorage is scoped
  // per origin (path irrelevant), and file: URLs share the file:// origin,
  // so the app's own renderer entry reaches the identity the vendored
  // webview wrote — even though that webview's own page no longer exists.
  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    return new URL('/', rendererUrl).href
  }
  return pathToFileURL(join(__dirname, '../renderer/index.html')).href
}

/**
 * Accepts both documented shapes of the legacy record: the vendored client's
 * own `{privateKey, pubkey, username}` (vendor/buzz-desktop/src/main.tsx) and
 * the `{privateKeyHex, pubkeyHex, username}` spelling. The pubkey field is
 * ignored — importParticipantPrivateKey re-derives it from the private key,
 * so a tampered/mismatched stored pubkey cannot poison the imported identity.
 */
function parseLegacyIdentity(raw: string): { privateKeyHex: string; username?: string } | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const privateKey =
      typeof parsed.privateKey === 'string' ? parsed.privateKey : parsed.privateKeyHex
    if (typeof privateKey !== 'string' || !/^[0-9a-fA-F]{64}$/.test(privateKey)) {
      return null
    }
    const username =
      typeof parsed.username === 'string' && parsed.username.trim() !== ''
        ? parsed.username
        : undefined
    return { privateKeyHex: privateKey.toLowerCase(), username }
  } catch {
    return null
  }
}

async function flagKeyMigrated(guest: Electron.WebContents): Promise<void> {
  await guest.executeJavaScript(
    `(() => { const value = window.localStorage.getItem(${JSON.stringify(LEGACY_IDENTITY_KEY)}); if (value !== null) { window.localStorage.setItem(${JSON.stringify(MIGRATED_IDENTITY_KEY)}, value); window.localStorage.removeItem(${JSON.stringify(LEGACY_IDENTITY_KEY)}) } })()`
  )
}

async function publishKind0Profile(username: string, source: 'migrated' | 'fresh'): Promise<void> {
  try {
    if (!(await waitForRelayReady())) {
      throw new Error('local relay did not become ready')
    }
    await submitRelayEvent(
      signParticipantEvent({
        kind: KIND_PROFILE_METADATA,
        content: JSON.stringify({ display_name: username, name: username }),
        tags: []
      })
    )
  } catch (err) {
    console.warn(`[communications] ${source} profile publish failed: ${errorMessage(err)}`)
  }
}

async function waitForRelayReady(): Promise<boolean> {
  const deadline = Date.now() + RELAY_READY_TIMEOUT_MS
  for (;;) {
    const status = getRelayStartupStatus()
    if (status.state === 'running') {
      return true
    }
    if (status.state === 'failed') {
      return false
    }
    if (Date.now() >= deadline) {
      return false
    }
    await new Promise((resolve) => setTimeout(resolve, RELAY_READY_POLL_MS))
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    )
  })
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
