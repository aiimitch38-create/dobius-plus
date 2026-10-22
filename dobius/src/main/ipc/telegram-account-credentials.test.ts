import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TelegramApplicationCredentialStore } from './telegram-account-credentials'
import type { TelegramCipher } from '../telegram-account/vault'

vi.mock('electron', () => ({ safeStorage: {} }))

const directories: string[] = []
const fakeCredentials = { apiId: 123, apiHash: 'abcdef0123456789abcdef0123456789' }
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'telegram-app-credentials-'))
  directories.push(directory)
  const path = join(directory, 'application.enc')
  // Synthetic cipher; tests verify custody/failure behavior, not OS cryptography.
  const cipher: TelegramCipher = {
    isSecureEncryptionAvailable: () => true,
    encrypt: (input) => Buffer.from(input).map((byte) => byte ^ 0xa5),
    decrypt: (input) =>
      Buffer.from(input)
        .map((byte) => byte ^ 0xa5)
        .toString()
  }
  return { path, cipher, store: new TelegramApplicationCredentialStore(path, cipher) }
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('Telegram application credential custody', () => {
  it('persists only ciphertext and reads back the registered application', () => {
    const { store, path } = fixture()
    store.save(fakeCredentials)
    expect(readFileSync(path, 'utf8')).not.toContain(fakeCredentials.apiHash)
    expect(store.load()).toEqual(fakeCredentials)
  })

  it('refuses plaintext fallback when OS encryption is unavailable', () => {
    const { store, cipher } = fixture()
    cipher.isSecureEncryptionAvailable = () => false
    expect(() => store.save(fakeCredentials)).toThrow('secure-storage-unavailable')
    expect(() => store.load()).toThrow('secure-storage-unavailable')
  })

  it('does not accept malformed application IDs, hashes, or extra secret fields', () => {
    const { store } = fixture()
    for (const input of [
      { ...fakeCredentials, apiId: 0 },
      { ...fakeCredentials, apiHash: 'bad' },
      { ...fakeCredentials, session: 'must-not-be-stored-here' }
    ]) {
      expect(() => store.save(input)).toThrow('invalid-input')
    }
  })

  it('redacts encryption and decoding failures', () => {
    const { store, cipher, path } = fixture()
    cipher.encrypt = () => {
      throw new Error(fakeCredentials.apiHash)
    }
    expect(() => store.save(fakeCredentials)).toThrow(/^storage-failed$/)
    writeFileSync(path, 'not-ciphertext')
    cipher.decrypt = () => {
      throw new Error(fakeCredentials.apiHash)
    }
    expect(() => store.load()).toThrow(/^authorization-failed$/)
  })

  it('refuses symbolic links and oversized credential files', () => {
    const { store, path } = fixture()
    const target = `${path}.target`
    writeFileSync(target, Buffer.alloc(4097))
    symlinkSync(target, path)
    expect(() => store.load()).toThrow('authorization-failed')
    rmSync(path)
    writeFileSync(path, Buffer.alloc(4097))
    expect(() => store.load()).toThrow('authorization-failed')
  })
})
