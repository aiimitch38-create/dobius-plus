import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type * as Os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../shared/types'
import type { VoiceSettings } from '../../shared/speech-types'

const safeStorageMock = vi.hoisted(() => ({
  decryptString: vi.fn((value: Buffer) => value.toString('utf8').replace(/^enc:/, '')),
  encryptString: vi.fn((value: string) => Buffer.from(`enc:${value}`)),
  isEncryptionAvailable: vi.fn(() => true)
}))

const testState = vi.hoisted(() => ({ home: '', isPackaged: true }))

// Fake value only: these tests never touch a real credential.
const KEY = 'sk_fake_elevenlabs_key'

async function loadStoreModule() {
  vi.resetModules()
  vi.doMock('electron', () => ({
    app: {
      get isPackaged() {
        return testState.isPackaged
      }
    },
    safeStorage: safeStorageMock
  }))
  vi.doMock('node:os', async () => {
    const actual = await vi.importActual<typeof Os>('node:os')
    return { ...actual, homedir: () => testState.home }
  })
  return import('./elevenlabs-key-store')
}

function keyFile(fileName = 'elevenlabs-token.enc'): string {
  return join(testState.home, '.dobius', fileName)
}

function writeKeyFile(contents: string, fileName?: string): void {
  mkdirSync(join(testState.home, '.dobius'), { recursive: true })
  writeFileSync(keyFile(fileName), contents)
}

function makeFakeStore(voice: Partial<VoiceSettings>) {
  let settings = { voice } as unknown as GlobalSettings
  const flush = vi.fn()
  return {
    flush,
    getSettings: () => settings,
    updateSettings: vi.fn((updates: Partial<GlobalSettings>) => {
      settings = { ...settings, ...updates }
      return settings
    })
  }
}

beforeEach(() => {
  testState.home = mkdtempSync(join(tmpdir(), 'dobius-elevenlabs-key-'))
  testState.isPackaged = true
  safeStorageMock.isEncryptionAvailable.mockReset().mockReturnValue(true)
  safeStorageMock.encryptString
    .mockReset()
    .mockImplementation((value: string) => Buffer.from(`enc:${value}`))
  safeStorageMock.decryptString
    .mockReset()
    .mockImplementation((value: Buffer) => value.toString('utf8').replace(/^enc:/, ''))
})

afterEach(() => {
  rmSync(testState.home, { recursive: true, force: true })
})

describe('ElevenLabs key store (#24, #25)', () => {
  it('saves the key encrypted and reads it back', async () => {
    const store = await loadStoreModule()
    expect(store.saveElevenLabsApiKey(`  ${KEY}  `)).toEqual({
      configured: true,
      sessionOnly: false,
      unreadable: false
    })
    expect(readFileSync(keyFile(), 'utf8')).toBe(`enc:${KEY}`)

    const fresh = await loadStoreModule()
    expect(fresh.readElevenLabsApiKey()).toBe(KEY)
  })

  it('writes nothing when encryption is unavailable and keeps the key for the session', async () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const store = await loadStoreModule()

    expect(store.saveElevenLabsApiKey(KEY)).toEqual({ configured: true, sessionOnly: true, unreadable: false })
    expect(existsSync(keyFile())).toBe(false)
    expect(store.readElevenLabsApiKey()).toBe(KEY)
  })

  it('writes nothing when encryptString throws', async () => {
    safeStorageMock.encryptString.mockImplementation(() => {
      throw new Error('keychain locked')
    })
    const store = await loadStoreModule()

    expect(store.saveElevenLabsApiKey(KEY).sessionOnly).toBe(true)
    expect(existsSync(keyFile())).toBe(false)
  })

  it('leaves an existing encrypted file byte-identical when a new key cannot be encrypted', async () => {
    mkdirSync(join(testState.home, '.dobius'), { recursive: true })
    writeFileSync(keyFile(), 'enc:old-key')
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const store = await loadStoreModule()

    store.saveElevenLabsApiKey(KEY)

    expect(readFileSync(keyFile(), 'utf8')).toBe('enc:old-key')
  })

  it('never treats stored bytes as plaintext when encryption is unavailable', async () => {
    mkdirSync(join(testState.home, '.dobius'), { recursive: true })
    writeFileSync(keyFile(), 'enc:old-key')
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const store = await loadStoreModule()

    expect(() => store.readElevenLabsApiKey()).toThrow('could not be decrypted')
    expect(store.resolveElevenLabsApiKey({ elevenlabsApiKey: '' })).toBe('')
  })
})

describe('migrateElevenLabsKeyOutOfSettings (#24)', () => {
  it('moves the settings key into the protected store and removes it from settings', async () => {
    const keyStore = await loadStoreModule()
    const settingsStore = makeFakeStore({ elevenlabsApiKey: KEY, elevenlabsVoiceId: 'voice-a' })

    expect(keyStore.migrateElevenLabsKeyOutOfSettings(settingsStore)).toBe('migrated')

    expect(readFileSync(keyFile(), 'utf8')).toBe(`enc:${KEY}`)
    const voice = settingsStore.getSettings().voice
    expect(voice).not.toHaveProperty('elevenlabsApiKey')
    expect(voice?.elevenlabsVoiceId).toBe('voice-a')
    expect(settingsStore.flush).toHaveBeenCalledOnce()
    expect(keyStore.resolveElevenLabsApiKey(voice)).toBe(KEY)
  })

  it('keeps the key in settings (still usable) when it cannot be encrypted', async () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const keyStore = await loadStoreModule()
    const settingsStore = makeFakeStore({ elevenlabsApiKey: KEY, elevenlabsVoiceId: 'voice-a' })

    expect(keyStore.migrateElevenLabsKeyOutOfSettings(settingsStore)).toBe('kept-in-settings')

    expect(existsSync(keyFile())).toBe(false)
    expect(settingsStore.updateSettings).not.toHaveBeenCalled()
    expect(keyStore.resolveElevenLabsApiKey(settingsStore.getSettings().voice)).toBe(KEY)
    expect(keyStore.getElevenLabsApiKeyStatus().sessionOnly).toBe(false)
  })

  it('keeps the key in settings when the protected store cannot be written', async () => {
    const keyStore = await loadStoreModule()
    // A file where the .dobius directory should be makes the write fail.
    writeFileSync(join(testState.home, '.dobius'), 'not a directory')
    const settingsStore = makeFakeStore({ elevenlabsApiKey: KEY })

    expect(keyStore.migrateElevenLabsKeyOutOfSettings(settingsStore)).toBe('kept-in-settings')

    expect(settingsStore.updateSettings).not.toHaveBeenCalled()
    expect(keyStore.resolveElevenLabsApiKey(settingsStore.getSettings().voice)).toBe(KEY)
  })

  it('does nothing when settings hold no key', async () => {
    const keyStore = await loadStoreModule()
    const settingsStore = makeFakeStore({ elevenlabsVoiceId: 'voice-a' })

    expect(keyStore.migrateElevenLabsKeyOutOfSettings(settingsStore)).toBe('none')
    expect(settingsStore.updateSettings).not.toHaveBeenCalled()
    expect(existsSync(keyFile())).toBe(false)
  })
})

describe('ElevenLabs key store review fixes (F1-F3)', () => {
  it('F1: keeps the settings key when the written file does not decrypt back to it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    safeStorageMock.decryptString.mockImplementation(() => 'something-else')
    const keyStore = await loadStoreModule()
    const settingsStore = makeFakeStore({ elevenlabsApiKey: KEY })

    expect(keyStore.migrateElevenLabsKeyOutOfSettings(settingsStore)).toBe('kept-in-settings')

    expect(settingsStore.updateSettings).not.toHaveBeenCalled()
    expect(existsSync(keyFile())).toBe(false)
    expect(existsSync(`${keyFile()}.verify`)).toBe(false)
    expect(keyStore.resolveElevenLabsApiKey(settingsStore.getSettings().voice)).toBe(KEY)
    warn.mockRestore()
  })

  it('F1: leaves the previous key file byte-identical when the new one does not verify', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    writeKeyFile('enc:previous-key')
    safeStorageMock.decryptString.mockImplementation(() => 'previous-key')
    const keyStore = await loadStoreModule()
    const settingsStore = makeFakeStore({ elevenlabsApiKey: KEY })

    expect(keyStore.migrateElevenLabsKeyOutOfSettings(settingsStore)).toBe('kept-in-settings')

    expect(readFileSync(keyFile(), 'utf8')).toBe('enc:previous-key')
    expect(settingsStore.updateSettings).not.toHaveBeenCalled()
    // The newer settings key, not the older file, is the one in use.
    expect(keyStore.resolveElevenLabsApiKey(settingsStore.getSettings().voice)).toBe(KEY)
    warn.mockRestore()
  })

  it('F1: keeps the settings key when the written file cannot be read back', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    safeStorageMock.decryptString.mockImplementation(() => {
      throw new Error('keychain denied')
    })
    const keyStore = await loadStoreModule()
    const settingsStore = makeFakeStore({ elevenlabsApiKey: KEY })

    expect(keyStore.migrateElevenLabsKeyOutOfSettings(settingsStore)).toBe('kept-in-settings')
    expect(settingsStore.updateSettings).not.toHaveBeenCalled()
    expect(existsSync(keyFile())).toBe(false)
    warn.mockRestore()
  })

  it('F2: an unpackaged build uses its own key file and never touches the packaged one', async () => {
    writeKeyFile('enc:packaged-key')
    testState.isPackaged = false
    const keyStore = await loadStoreModule()

    keyStore.saveElevenLabsApiKey(KEY)
    expect(readFileSync(keyFile('elevenlabs-token.dev.enc'), 'utf8')).toBe(`enc:${KEY}`)
    keyStore.clearElevenLabsApiKey()

    expect(readFileSync(keyFile(), 'utf8')).toBe('enc:packaged-key')
    expect(existsSync(keyFile('elevenlabs-token.dev.enc'))).toBe(false)
  })

  it('F2: migration never overwrites an existing key file it cannot decrypt', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    writeKeyFile('foreign-ciphertext')
    safeStorageMock.decryptString.mockImplementation((value: Buffer) => {
      const text = value.toString('utf8')
      if (!text.startsWith('enc:')) {
        throw new Error('wrong keychain identity')
      }
      return text.slice('enc:'.length)
    })
    const keyStore = await loadStoreModule()
    const settingsStore = makeFakeStore({ elevenlabsApiKey: KEY })

    expect(keyStore.migrateElevenLabsKeyOutOfSettings(settingsStore)).toBe('kept-in-settings')
    expect(keyStore.migrateElevenLabsKeyOutOfSettings(settingsStore)).toBe('kept-in-settings')

    expect(readFileSync(keyFile(), 'utf8')).toBe('foreign-ciphertext')
    expect(settingsStore.updateSettings).not.toHaveBeenCalled()
    expect(keyStore.resolveElevenLabsApiKey(settingsStore.getSettings().voice)).toBe(KEY)
    const unreadableWarnings = warn.mock.calls.filter((call) =>
      String(call[0]).includes('existing key file cannot be decrypted')
    )
    expect(unreadableWarnings).toHaveLength(1)
    warn.mockRestore()
  })

  it('F3: status reports a key file this build cannot decrypt as unreadable', async () => {
    writeKeyFile('foreign-ciphertext')
    safeStorageMock.decryptString.mockImplementation(() => {
      throw new Error('wrong keychain identity')
    })
    const keyStore = await loadStoreModule()

    expect(keyStore.getElevenLabsApiKeyStatus()).toEqual({
      configured: true,
      sessionOnly: false,
      unreadable: true
    })
  })

  it('F3: status is not unreadable for a readable key file', async () => {
    writeKeyFile(`enc:${KEY}`)
    const keyStore = await loadStoreModule()

    expect(keyStore.getElevenLabsApiKeyStatus()).toEqual({
      configured: true,
      sessionOnly: false,
      unreadable: false
    })
  })
})

describe('resolveElevenLabsApiKey precedence', () => {
  it('a key saved this session wins over an unmigrated settings key', async () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const keyStore = await loadStoreModule()

    keyStore.saveElevenLabsApiKey('sk_fake_session_key')

    expect(keyStore.resolveElevenLabsApiKey({ elevenlabsApiKey: KEY })).toBe('sk_fake_session_key')
  })
})
