import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type * as Os from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const safeStorageMock = vi.hoisted(() => ({
  decryptString: vi.fn((value: Buffer) => value.toString('utf8')),
  encryptString: vi.fn((value: string) => Buffer.from(value)),
  isEncryptionAvailable: vi.fn(() => true)
}))

let tempHome = ''

async function loadStoreModule() {
  vi.resetModules()
  vi.doMock('electron', () => ({
    safeStorage: safeStorageMock
  }))
  vi.doMock('os', async () => {
    const actual = await vi.importActual<typeof Os>('os')
    return { ...actual, homedir: () => tempHome }
  })
  return import('./openai-api-key-store')
}

beforeEach(() => {
  tempHome = mkdtempLike('dobius-openai-key-store-')
  safeStorageMock.decryptString.mockClear()
  safeStorageMock.encryptString.mockClear()
  safeStorageMock.isEncryptionAvailable.mockClear()
  safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
  safeStorageMock.encryptString.mockImplementation((value: string) => Buffer.from(value))
})

function mkdtempLike(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function writeStoredOpenAiKey(value: string): void {
  const dobiusDir = join(tempHome, '.dobius')
  mkdirSync(dobiusDir, { recursive: true })
  writeFileSync(join(dobiusDir, 'openai-speech-token.enc'), value)
}

describe('OpenAI speech API key store', () => {
  it('checks configured status without decrypting or touching safeStorage', async () => {
    writeStoredOpenAiKey('encrypted-key')
    const store = await loadStoreModule()

    expect(store.hasOpenAiSpeechApiKey()).toBe(true)
    expect(safeStorageMock.isEncryptionAvailable).not.toHaveBeenCalled()
    expect(safeStorageMock.decryptString).not.toHaveBeenCalled()
  })

  it('decrypts only when the key is read for an API request', async () => {
    writeStoredOpenAiKey('encrypted-key')
    const store = await loadStoreModule()

    expect(store.readOpenAiSpeechApiKey()).toBe('encrypted-key')
    expect(safeStorageMock.decryptString).toHaveBeenCalledOnce()
  })

  it('caches the decrypted key so repeated dictations do not repeatedly touch safeStorage', async () => {
    writeStoredOpenAiKey('encrypted-key')
    const store = await loadStoreModule()

    expect(store.readOpenAiSpeechApiKey()).toBe('encrypted-key')
    expect(store.readOpenAiSpeechApiKey()).toBe('encrypted-key')
    expect(safeStorageMock.decryptString).toHaveBeenCalledOnce()
  })

  it('uses the in-memory key after save without decrypting from safeStorage', async () => {
    const store = await loadStoreModule()

    store.saveOpenAiSpeechApiKey('saved-key')

    expect(store.readOpenAiSpeechApiKey()).toBe('saved-key')
    expect(safeStorageMock.decryptString).not.toHaveBeenCalled()
  })

  it('reports missing status without creating storage files', async () => {
    const store = await loadStoreModule()

    expect(store.hasOpenAiSpeechApiKey()).toBe(false)
    expect(existsSync(join(tempHome, '.dobius'))).toBe(false)
    expect(safeStorageMock.decryptString).not.toHaveBeenCalled()
  })

  describe('when safeStorage cannot encrypt (#25)', () => {
    const FAKE_KEY = 'sk-test-fake-session-key'

    function keyPath(): string {
      return join(tempHome, '.dobius', 'openai-speech-token.enc')
    }

    it('never writes the key when encryption is unavailable, but keeps it for the session', async () => {
      safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
      const store = await loadStoreModule()

      expect(store.saveOpenAiSpeechApiKey(FAKE_KEY)).toEqual({
        configured: true,
        sessionOnly: true
      })

      expect(existsSync(keyPath())).toBe(false)
      expect(store.readOpenAiSpeechApiKey()).toBe(FAKE_KEY)
      expect(store.getOpenAiSpeechApiKeyStatus()).toEqual({ configured: true, sessionOnly: true })
    })

    it('never writes the key when encryptString throws', async () => {
      safeStorageMock.encryptString.mockImplementation(() => {
        throw new Error('keychain locked')
      })
      const store = await loadStoreModule()

      expect(store.saveOpenAiSpeechApiKey(FAKE_KEY).sessionOnly).toBe(true)

      expect(existsSync(keyPath())).toBe(false)
      expect(store.readOpenAiSpeechApiKey()).toBe(FAKE_KEY)
    })

    it('leaves an existing encrypted key file byte-for-byte intact', async () => {
      writeStoredOpenAiKey('existing-ciphertext')
      safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
      const store = await loadStoreModule()

      store.saveOpenAiSpeechApiKey(FAKE_KEY)

      expect(readFileSync(keyPath(), 'utf8')).toBe('existing-ciphertext')
      expect(store.readOpenAiSpeechApiKey()).toBe(FAKE_KEY)
    })

    it('reports a durable key once encryption works again', async () => {
      safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
      const store = await loadStoreModule()
      store.saveOpenAiSpeechApiKey(FAKE_KEY)

      safeStorageMock.isEncryptionAvailable.mockReturnValue(true)

      expect(store.saveOpenAiSpeechApiKey(FAKE_KEY)).toEqual({
        configured: true,
        sessionOnly: false
      })
      expect(existsSync(keyPath())).toBe(true)
    })
  })
})
