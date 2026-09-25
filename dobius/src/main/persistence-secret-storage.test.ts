import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writeFileSync, readFileSync, rmSync, mkdtempSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const testState = vi.hoisted(() => ({ dir: '' }))

const safeStorageMock = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8')),
  decryptString: vi.fn((ciphertext: Buffer) => {
    const decoded = ciphertext.toString('utf-8')
    if (!decoded.startsWith('encrypted:')) {
      throw new Error('invalid ciphertext')
    }
    return decoded.slice('encrypted:'.length)
  })
}))

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: safeStorageMock
}))

vi.mock('./telemetry/client', () => ({ track: vi.fn() }))
vi.mock('./telemetry/cohort-classifier', () => ({
  getCohortAtEmit: vi.fn(() => ({ nth_repo_added: 2 }))
}))

// Fake values only: these tests never touch real credentials.
const COOKIE = 'fake-opencode-cookie'
const PROXY = 'http://user:fake-pass@proxy.invalid:8080'
const KAGI = 'https://kagi.invalid/search?token=fake'

async function createStore() {
  vi.resetModules()
  const { Store, initDataPath } = await import('./persistence')
  initDataPath()
  return new Store()
}

function dataFile(): string {
  return join(testState.dir, 'dobius-data.json')
}

function readRawDataFile(): string {
  return readFileSync(dataFile(), 'utf-8')
}

function encryptedB64(plaintext: string): string {
  return Buffer.from(`encrypted:${plaintext}`, 'utf-8').toString('base64')
}

function writeDataFileWithEncryptedSecrets(): void {
  mkdirSync(testState.dir, { recursive: true })
  writeFileSync(
    dataFile(),
    JSON.stringify({
      schemaVersion: 1,
      repos: [],
      worktreeMeta: {},
      settings: { opencodeSessionCookie: encryptedB64(COOKIE), httpProxyUrl: encryptedB64(PROXY) },
      ui: { browserKagiSessionLink: encryptedB64(KAGI) },
      githubCache: { pr: {}, issue: {} },
      workspaceSession: {}
    }),
    'utf-8'
  )
}

function expectNoPlaintextSecrets(raw: string, secrets: string[]): void {
  for (const secret of secrets) {
    expect(raw.includes(secret)).toBe(false)
  }
}

describe('Store secret persistence fails closed (#25)', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'dobius-secret-test-'))
    safeStorageMock.isEncryptionAvailable.mockReset().mockReturnValue(true)
    safeStorageMock.encryptString
      .mockReset()
      .mockImplementation((plaintext: string) => Buffer.from(`encrypted:${plaintext}`, 'utf-8'))
  })

  afterEach(() => {
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('writes no plaintext secrets when encryption is unavailable, and keeps them for the session', async () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const store = await createStore()

    store.updateSettings({ opencodeSessionCookie: COOKIE, httpProxyUrl: PROXY })
    store.updateUI({ browserKagiSessionLink: KAGI })
    store.flush()

    expectNoPlaintextSecrets(readRawDataFile(), [COOKIE, PROXY, KAGI])
    const persisted = JSON.parse(readRawDataFile())
    expect(persisted.settings.opencodeSessionCookie).toBe('')
    expect(persisted.settings.httpProxyUrl).toBe('')
    expect(persisted.ui.browserKagiSessionLink).toBeNull()

    expect(store.getSettings().opencodeSessionCookie).toBe(COOKIE)
    expect(store.getSettings().httpProxyUrl).toBe(PROXY)
    expect(store.getUI().browserKagiSessionLink).toBe(KAGI)
    expect(store.getSecretStorageStatus()).toEqual({
      encryptionAvailable: false,
      sessionOnlySecrets: ['opencodeSessionCookie', 'httpProxyUrl', 'browserKagiSessionLink']
    })
  })

  it('writes no plaintext secrets when encryptString throws', async () => {
    safeStorageMock.encryptString.mockImplementation(() => {
      throw new Error('keychain locked')
    })
    const store = await createStore()

    store.updateSettings({ opencodeSessionCookie: COOKIE, httpProxyUrl: PROXY })
    store.updateUI({ browserKagiSessionLink: KAGI })
    store.flush()

    expectNoPlaintextSecrets(readRawDataFile(), [COOKIE, PROXY, KAGI])
    expect(store.getSettings().opencodeSessionCookie).toBe(COOKIE)
    expect(store.getSecretStorageStatus().sessionOnlySecrets).toHaveLength(3)
  })

  it('keeps existing encrypted values intact when a save cannot encrypt', async () => {
    writeDataFileWithEncryptedSecrets()
    const store = await createStore()
    expect(store.getSettings().opencodeSessionCookie).toBe(COOKIE)

    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    // An unrelated change forces a full save of the unchanged secrets.
    store.updateSettings({ theme: 'light' })
    store.flush()

    const persisted = JSON.parse(readRawDataFile())
    expect(persisted.settings.opencodeSessionCookie).toBe(encryptedB64(COOKIE))
    expect(persisted.settings.httpProxyUrl).toBe(encryptedB64(PROXY))
    expect(persisted.ui.browserKagiSessionLink).toBe(encryptedB64(KAGI))
    expect(store.getSecretStorageStatus().sessionOnlySecrets).toEqual([])
  })

  it('keeps the previous encrypted value on disk when a new value cannot be encrypted', async () => {
    writeDataFileWithEncryptedSecrets()
    const store = await createStore()

    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const newCookie = 'fake-new-cookie'
    store.updateSettings({ opencodeSessionCookie: newCookie })
    store.flush()

    const raw = readRawDataFile()
    expectNoPlaintextSecrets(raw, [newCookie])
    expect(JSON.parse(raw).settings.opencodeSessionCookie).toBe(encryptedB64(COOKIE))
    expect(store.getSettings().opencodeSessionCookie).toBe(newCookie)
    expect(store.getSecretStorageStatus().sessionOnlySecrets).toEqual(['opencodeSessionCookie'])
  })

  it('persists the session-only value encrypted once encryption works again', async () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const store = await createStore()
    store.updateSettings({ opencodeSessionCookie: COOKIE })
    store.flush()

    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    store.updateSettings({ httpProxyUrl: PROXY })
    store.flush()

    const persisted = JSON.parse(readRawDataFile())
    expect(persisted.settings.opencodeSessionCookie).toBe(encryptedB64(COOKIE))
    expect(persisted.settings.httpProxyUrl).toBe(encryptedB64(PROXY))
    expect(store.getSecretStorageStatus()).toEqual({
      encryptionAvailable: true,
      sessionOnlySecrets: []
    })
  })
})
