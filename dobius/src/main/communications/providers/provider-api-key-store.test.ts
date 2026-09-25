import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type * as Os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const safeStorageMock = vi.hoisted(() => ({
  decryptString: vi.fn((value: Buffer) => value.toString('utf8').replace(/^enc:/, '')),
  encryptString: vi.fn((value: string) => Buffer.from(`enc:${value}`)),
  isEncryptionAvailable: vi.fn(() => true)
}))

let tempHome = ''
// Fake value only: these tests never touch a real credential.
const KEY = 'sk-or-fake-provider-key'

async function loadStoreModule() {
  vi.resetModules()
  vi.doMock('electron', () => ({ safeStorage: safeStorageMock }))
  vi.doMock('node:os', async () => {
    const actual = await vi.importActual<typeof Os>('node:os')
    return { ...actual, homedir: () => tempHome }
  })
  return import('./provider-api-key-store')
}

function keyFile(): string {
  return join(tempHome, '.dobius', 'openrouter-token.enc')
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'dobius-provider-key-'))
  safeStorageMock.isEncryptionAvailable.mockReset().mockReturnValue(true)
  safeStorageMock.encryptString
    .mockReset()
    .mockImplementation((value: string) => Buffer.from(`enc:${value}`))
})

afterEach(() => {
  rmSync(tempHome, { recursive: true, force: true })
})

describe('provider API key store fails closed (#25)', () => {
  it('writes the key encrypted when safeStorage works', async () => {
    const store = await loadStoreModule()
    store.saveProviderApiKey('openrouter', KEY)
    expect(readFileSync(keyFile(), 'utf8')).toBe(`enc:${KEY}`)
  })

  it('writes nothing when encryption is unavailable and keeps the key for the session', async () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const store = await loadStoreModule()

    store.saveProviderApiKey('openrouter', KEY)

    expect(existsSync(keyFile())).toBe(false)
    expect(store.hasProviderApiKey('openrouter')).toBe(true)
    expect(store.readProviderApiKey('openrouter')).toBe(KEY)
  })

  it('writes nothing when encryptString throws', async () => {
    safeStorageMock.encryptString.mockImplementation(() => {
      throw new Error('keychain locked')
    })
    const store = await loadStoreModule()

    store.saveProviderApiKey('openrouter', KEY)

    expect(existsSync(keyFile())).toBe(false)
    expect(store.readProviderApiKey('openrouter')).toBe(KEY)
  })

  it('leaves an existing encrypted file byte-identical when a new key cannot be encrypted', async () => {
    mkdirSync(join(tempHome, '.dobius'), { recursive: true })
    writeFileSync(keyFile(), 'enc:older-key')
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const store = await loadStoreModule()

    store.saveProviderApiKey('openrouter', KEY)

    expect(readFileSync(keyFile(), 'utf8')).toBe('enc:older-key')
  })

  it('clearing a session-only key reports no key', async () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const store = await loadStoreModule()
    store.saveProviderApiKey('openrouter', KEY)

    store.clearProviderApiKey('openrouter')

    expect(store.hasProviderApiKey('openrouter')).toBe(false)
  })
})
