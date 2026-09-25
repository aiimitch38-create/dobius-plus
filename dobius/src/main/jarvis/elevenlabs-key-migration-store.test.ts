import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type * as Os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Real Store + real key store against temp dirs: proves the key leaves the
// serialized primary and every backup written after the migration (#24).
const testState = vi.hoisted(() => ({ dir: '', home: '' }))

const safeStorageMock = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8')),
  decryptString: vi.fn((ciphertext: Buffer) =>
    ciphertext.toString('utf-8').replace(/^encrypted:/, '')
  )
}))

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: safeStorageMock
}))

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof Os>('node:os')
  return { ...actual, homedir: () => testState.home }
})

vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({
  getCohortAtEmit: vi.fn(() => ({ nth_repo_added: 2 }))
}))

// Fake value only: these tests never touch a real credential.
const KEY = 'sk_fake_elevenlabs_migration_key'

function dataFile(): string {
  return join(testState.dir, 'dobius-data.json')
}

function writeLegacyFixture(): void {
  mkdirSync(testState.dir, { recursive: true })
  const legacy = JSON.stringify({
    schemaVersion: 1,
    repos: [],
    worktreeMeta: {},
    settings: { voice: { elevenlabsApiKey: KEY, elevenlabsVoiceId: 'voice-a' } },
    ui: {},
    githubCache: { pr: {}, issue: {} },
    workspaceSession: {}
  })
  writeFileSync(dataFile(), legacy, 'utf-8')
  // An existing backup old enough that the next save rotates the ring.
  writeFileSync(`${dataFile()}.bak.0`, legacy, 'utf-8')
  const twoHoursAgo = (Date.now() - 2 * 60 * 60 * 1000) / 1000
  utimesSync(`${dataFile()}.bak.0`, twoHoursAgo, twoHoursAgo)
}

async function loadModules() {
  vi.resetModules()
  const { Store, initDataPath } = await import('../persistence')
  const keyStore = await import('./elevenlabs-key-store')
  initDataPath()
  return { store: new Store(), keyStore }
}

describe('ElevenLabs key migration through the public Store API (#24)', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'dobius-elevenlabs-migration-'))
    testState.home = mkdtempSync(join(tmpdir(), 'dobius-elevenlabs-home-'))
    safeStorageMock.isEncryptionAvailable.mockReset().mockReturnValue(true)
  })

  afterEach(() => {
    rmSync(testState.dir, { recursive: true, force: true })
    rmSync(testState.home, { recursive: true, force: true })
  })

  it('leaves no key in the primary file or in the backup written after migration', async () => {
    writeLegacyFixture()
    const { store, keyStore } = await loadModules()

    expect(keyStore.migrateElevenLabsKeyOutOfSettings(store)).toBe('migrated')

    expect(readFileSync(dataFile(), 'utf-8').includes(KEY)).toBe(false)
    // The rotation copied the freshly written primary into .bak.0.
    expect(readFileSync(`${dataFile()}.bak.0`, 'utf-8').includes(KEY)).toBe(false)
    // Pre-existing backups are not deleted (Decision for Carson).
    expect(readFileSync(`${dataFile()}.bak.1`, 'utf-8').includes(KEY)).toBe(true)

    const persisted = JSON.parse(readFileSync(dataFile(), 'utf-8'))
    expect(persisted.settings.voice.elevenlabsVoiceId).toBe('voice-a')
    expect(store.getSettings().voice).not.toHaveProperty('elevenlabsApiKey')
    expect(keyStore.resolveElevenLabsApiKey(store.getSettings().voice)).toBe(KEY)
  })

  it('keeps the key usable when migration cannot encrypt it', async () => {
    writeLegacyFixture()
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const { store, keyStore } = await loadModules()
    const before = readFileSync(dataFile(), 'utf-8')

    expect(keyStore.migrateElevenLabsKeyOutOfSettings(store)).toBe('kept-in-settings')

    expect(readFileSync(dataFile(), 'utf-8')).toBe(before)
    expect(existsSync(join(testState.home, '.dobius', 'elevenlabs-token.enc'))).toBe(false)
    expect(keyStore.resolveElevenLabsApiKey(store.getSettings().voice)).toBe(KEY)
  })
})
