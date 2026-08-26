import { schnorr } from '@noble/curves/secp256k1'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type * as Os from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { RelayStartupStatus } from './relay/relay-startup-status'
import type { SignedCommunicationsEvent } from './participant-identity-store'

const sessionFromPartitionMock = vi.hoisted(() => vi.fn(() => ({})))
// Must be a constructible function (not an arrow) — the migration does `new BrowserWindow(...)`.
const browserWindowCreateMock = vi.hoisted(() =>
  vi.fn(function fakeBrowserWindow(): FakeWindow {
    throw new Error('fake BrowserWindow not configured')
  })
)
const submitRelayEventMock = vi.hoisted(() =>
  vi.fn(async (_event: SignedCommunicationsEvent) => undefined)
)
const getRelayStartupStatusMock = vi.hoisted(() =>
  vi.fn((): RelayStartupStatus => ({ state: 'running' }))
)

vi.mock('electron', () => ({
  session: { fromPartition: sessionFromPartitionMock },
  BrowserWindow: browserWindowCreateMock,
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString('utf8')
  }
}))

vi.mock('./identity/relay-http-client', () => ({
  submitRelayEvent: submitRelayEventMock
}))

vi.mock('./relay/relay-startup-status', () => ({
  getRelayStartupStatus: getRelayStartupStatusMock
}))

import type * as StoreModule from './participant-identity-store'

const LEGACY_KEY = 'dobius-buzz-identity.v1'
const MIGRATED_KEY = `${LEGACY_KEY}-migrated`

type FakeWindow = {
  webContents: {
    loadURL: ReturnType<typeof vi.fn>
    executeJavaScript: ReturnType<typeof vi.fn>
  }
  destroy: ReturnType<typeof vi.fn>
}

let storage: Map<string, string>
let guests: FakeWindow[]
let capturedCreatedListener: ((identity: StoreModule.ParticipantPublicIdentity) => void) | null
let importParticipantPrivateKeyMock: Mock<
  (privateKeyHex: string, username?: string) => StoreModule.ParticipantPublicIdentity
>

function makeFakeGuest(): FakeWindow {
  const guest: FakeWindow = {
    webContents: {
      loadURL: vi.fn(async () => undefined),
      executeJavaScript: vi.fn(async (script: string) => {
        // The rename script embeds a setItem call; the snapshot script only reads.
        if (script.includes('setItem')) {
          const value = storage.get(LEGACY_KEY)
          if (value !== null && value !== undefined) {
            storage.set(MIGRATED_KEY, value)
            storage.delete(LEGACY_KEY)
          }
          return undefined
        }
        return {
          current: storage.get(LEGACY_KEY) ?? null,
          migrated: storage.get(MIGRATED_KEY) ?? null
        }
      })
    },
    destroy: vi.fn()
  }
  guests.push(guest)
  return guest
}

async function loadMigrationModule(options: { hasIdentity?: boolean } = {}) {
  vi.resetModules()
  vi.doMock('./participant-identity-store', async () => {
    const actual = await vi.importActual<typeof StoreModule>('./participant-identity-store')
    return {
      ...actual,
      hasParticipantIdentity: () => options.hasIdentity ?? false,
      importParticipantPrivateKey: (...args: unknown[]) =>
        importParticipantPrivateKeyMock(
          args[0] as string,
          args[1] as string | undefined
        ) as StoreModule.ParticipantPublicIdentity,
      onParticipantIdentityCreated: (
        listener: (identity: StoreModule.ParticipantPublicIdentity) => void
      ) => {
        capturedCreatedListener = listener
      },
      signParticipantEvent: (event: { kind: number; content: string; tags: string[][] }) => ({
        id: 'event-id',
        pubkey: 'a'.repeat(64),
        created_at: 1_700_000_000,
        kind: event.kind,
        tags: event.tags,
        content: event.content,
        sig: 'b'.repeat(128)
      })
    }
  })
  return import('./participant-identity-buzz-migration')
}

function legacyRecord(privateKeyHex: string): string {
  // The shape the vendored client actually wrote (vendor/buzz-desktop/src/main.tsx).
  return JSON.stringify({
    privateKey: privateKeyHex,
    pubkey: 'c'.repeat(64),
    username: 'buzzuser'
  })
}

beforeEach(() => {
  storage = new Map()
  guests = []
  capturedCreatedListener = null
  sessionFromPartitionMock.mockClear()
  browserWindowCreateMock.mockClear()
  browserWindowCreateMock.mockImplementation(function fakeBrowserWindow() {
    return makeFakeGuest()
  })
  submitRelayEventMock.mockClear()
  getRelayStartupStatusMock.mockReset()
  getRelayStartupStatusMock.mockReturnValue({ state: 'running' })
  importParticipantPrivateKeyMock = vi.fn((_privateKeyHex: string, username?: string) => ({
    pubkey: 'd'.repeat(64),
    username: username ?? 'dobius'
  }))
})

describe('runCommunicationsBuzzIdentityMigration', () => {
  it('imports a valid legacy identity, renames the key, and publishes a kind-0 profile', async () => {
    const privateKeyHex = Buffer.from(schnorr.utils.randomPrivateKey()).toString('hex')
    storage.set(LEGACY_KEY, legacyRecord(privateKeyHex))
    const migration = await loadMigrationModule()

    const outcome = await migration.runCommunicationsBuzzIdentityMigration()

    expect(outcome).toBe('migrated')
    expect(importParticipantPrivateKeyMock).toHaveBeenCalledWith(
      privateKeyHex.toLowerCase(),
      'buzzuser'
    )
    expect(storage.has(LEGACY_KEY)).toBe(false)
    expect(storage.get(MIGRATED_KEY)).toBe(legacyRecord(privateKeyHex))
    await vi.waitFor(() => expect(submitRelayEventMock).toHaveBeenCalledTimes(1))
    const published = submitRelayEventMock.mock.calls[0][0] as { kind: number; content: string }
    expect(published.kind).toBe(0)
    expect(JSON.parse(published.content)).toEqual({ display_name: 'buzzuser', name: 'buzzuser' })
    expect(guests[0].destroy).toHaveBeenCalled()
  })

  it('accepts the privateKeyHex/pubkeyHex record spelling and falls back to the store username', async () => {
    const privateKeyHex = Buffer.from(schnorr.utils.randomPrivateKey()).toString('hex')
    storage.set(
      LEGACY_KEY,
      JSON.stringify({ privateKeyHex, pubkeyHex: 'c'.repeat(64), username: '' })
    )
    const migration = await loadMigrationModule()

    const outcome = await migration.runCommunicationsBuzzIdentityMigration()

    expect(outcome).toBe('migrated')
    expect(importParticipantPrivateKeyMock).toHaveBeenCalledWith(privateKeyHex, undefined)
    await vi.waitFor(() => expect(submitRelayEventMock).toHaveBeenCalled())
    expect(JSON.parse((submitRelayEventMock.mock.calls[0][0] as { content: string }).content)).toEqual({
      display_name: 'dobius',
      name: 'dobius'
    })
  })

  it('skips without touching the partition when a participant identity already exists', async () => {
    const migration = await loadMigrationModule({ hasIdentity: true })

    const outcome = await migration.runCommunicationsBuzzIdentityMigration()

    expect(outcome).toBe('skipped-existing-identity')
    expect(browserWindowCreateMock).not.toHaveBeenCalled()
    expect(submitRelayEventMock).not.toHaveBeenCalled()
  })

  it('warns once, imports nothing, and flags the key when the stored JSON is invalid', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      storage.set(LEGACY_KEY, '{not json at all')
      const migration = await loadMigrationModule()

      const outcome = await migration.runCommunicationsBuzzIdentityMigration()

      expect(outcome).toBe('failed-invalid-json')
      expect(importParticipantPrivateKeyMock).not.toHaveBeenCalled()
      expect(submitRelayEventMock).not.toHaveBeenCalled()
      expect(storage.has(LEGACY_KEY)).toBe(false)
      expect(storage.has(MIGRATED_KEY)).toBe(true)
      expect(warnSpy).toHaveBeenCalledTimes(1)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('skips silently when the legacy key was already migrated in an earlier run', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      storage.set(MIGRATED_KEY, legacyRecord('f'.repeat(64)))
      const migration = await loadMigrationModule()

      const outcome = await migration.runCommunicationsBuzzIdentityMigration()

      expect(outcome).toBe('skipped-already-migrated')
      expect(importParticipantPrivateKeyMock).not.toHaveBeenCalled()
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('skips silently on a fresh install with no legacy keys at all', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const migration = await loadMigrationModule()

      const outcome = await migration.runCommunicationsBuzzIdentityMigration()

      expect(outcome).toBe('skipped-no-legacy-identity')
      expect(importParticipantPrivateKeyMock).not.toHaveBeenCalled()
      expect(submitRelayEventMock).not.toHaveBeenCalled()
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('warns once and continues with startup when the partition read fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      browserWindowCreateMock.mockImplementation(function fakeBrowserWindow() {
        const guest = makeFakeGuest()
        guest.webContents.loadURL.mockRejectedValue(new Error('partition session unavailable'))
        return guest
      })
      const migration = await loadMigrationModule()

      const outcome = await migration.runCommunicationsBuzzIdentityMigration()

      expect(outcome).toBe('failed-storage-read')
      expect(importParticipantPrivateKeyMock).not.toHaveBeenCalled()
      expect(guests[0].destroy).toHaveBeenCalled()
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy.mock.calls.flat().join(' ')).toContain('partition session unavailable')
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('never logs private key material when post-import steps fail', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const privateKeyHex = Buffer.from(schnorr.utils.randomPrivateKey()).toString('hex')
      storage.set(LEGACY_KEY, legacyRecord(privateKeyHex))
      browserWindowCreateMock.mockImplementation(function fakeBrowserWindow() {
        const guest = makeFakeGuest()
        guest.webContents.executeJavaScript.mockImplementation((script: string) => {
          // The rename script is the only one containing setItem; the snapshot
          // script mentions both keys, so key matching cannot tell them apart.
          if (script.includes('setItem')) {
            return Promise.reject(new Error('storage write refused'))
          }
          return Promise.resolve({
            current: storage.get(LEGACY_KEY) ?? null,
            migrated: storage.get(MIGRATED_KEY) ?? null
          })
        })
        return guest
      })
      const migration = await loadMigrationModule()

      await migration.runCommunicationsBuzzIdentityMigration()

      expect(importParticipantPrivateKeyMock).toHaveBeenCalledWith(
        privateKeyHex.toLowerCase(),
        'buzzuser'
      )
      expect(warnSpy.mock.calls.flat().join(' ')).not.toContain(privateKeyHex)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('runs only once per process even when called again', async () => {
    const migration = await loadMigrationModule()

    const first = await migration.runCommunicationsBuzzIdentityMigration()
    const second = await migration.runCommunicationsBuzzIdentityMigration()

    expect(first).toBe('skipped-no-legacy-identity')
    expect(second).toBe('skipped-repeat-call')
    expect(browserWindowCreateMock).toHaveBeenCalledTimes(1)
  })
})

describe('fresh identity profile publishing via the created hook', () => {
  it('publishes a kind-0 profile with the given username for a fresh identity', async () => {
    const migration = await loadMigrationModule()
    await migration.runCommunicationsBuzzIdentityMigration()
    expect(capturedCreatedListener).toBeTypeOf('function')

    capturedCreatedListener!({ pubkey: 'e'.repeat(64), username: 'carson' })
    await vi.waitFor(() => expect(submitRelayEventMock).toHaveBeenCalledTimes(1))

    const published = submitRelayEventMock.mock.calls[0][0] as { kind: number; content: string }
    expect(published.kind).toBe(0)
    expect(JSON.parse(published.content)).toEqual({ display_name: 'carson', name: 'carson' })
  })

  it('warns instead of throwing when the relay never becomes ready', async () => {
    getRelayStartupStatusMock.mockReturnValue({ state: 'failed' as const })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const migration = await loadMigrationModule()
      await migration.runCommunicationsBuzzIdentityMigration()

      capturedCreatedListener!({ pubkey: 'e'.repeat(64), username: 'carson' })
      await vi.waitFor(() => expect(warnSpy).toHaveBeenCalledTimes(1))

      expect(submitRelayEventMock).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })
})

describe('participant identity store integration', () => {
  it('fires the created hook only for generated identities, not existing reads or imports', async () => {
    vi.resetModules()
    vi.doUnmock('./participant-identity-store')
    const tempHome = mkdtempSync(join(tmpdir(), 'dobius-buzz-migration-store-'))
    vi.doMock('os', async () => ({
      ...(await vi.importActual<typeof Os>('node:os')),
      homedir: () => tempHome
    }))

    const store = await import('./participant-identity-store')
    const created: string[] = []
    store.onParticipantIdentityCreated((identity) => created.push(identity.username))

    const first = store.ensureParticipantIdentity()
    expect(created).toEqual([first.username])

    const reread = store.ensureParticipantIdentity()
    expect(reread).toEqual(first)
    expect(created).toHaveLength(1)

    store.clearParticipantIdentity()
    const regenerated = store.ensureParticipantIdentity()
    expect(regenerated.pubkey).not.toBe(first.pubkey)
    expect(created).toHaveLength(2)

    const imported = store.importParticipantPrivateKey(
      Buffer.from(schnorr.utils.randomPrivateKey()).toString('hex'),
      'imported-user'
    )
    expect(created).toHaveLength(2)
    expect(imported.username).toBe('imported-user')

    vi.doUnmock('os')
  })
})
