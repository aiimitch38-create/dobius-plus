import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString()
  }
}))

import { TelegramAccountVault, TelegramVaultError, type TelegramCipher } from './vault'
import { emptyState, TEST_SESSION } from './test-support'

const directories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dobius-telegram-vault-'))
  directories.push(directory)
  return directory
}

function fakeCipher(available = true): TelegramCipher {
  return {
    isSecureEncryptionAvailable: () => available,
    encrypt: (text) => Buffer.from(`cipher:${Buffer.from(text).toString('base64')}`),
    decrypt: (raw) => {
      const value = raw.toString()
      if (!value.startsWith('cipher:')) {
        throw new Error('bad ciphertext')
      }
      return Buffer.from(value.slice('cipher:'.length), 'base64').toString()
    }
  }
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Telegram encrypted session vault', () => {
  it('round trips only encrypted session and outbox data through an atomic private file', () => {
    const file = join(temporaryDirectory(), 'telegram-account.enc')
    const vault = new TelegramAccountVault(file, fakeCipher())
    const state = {
      ...emptyState(),
      account: { userId: '77' },
      session: TEST_SESSION,
      outbox: [
        {
          key: '77:-1001:draft',
          draftId: 'draft',
          groupId: '-1001',
          body: 'private reply',
          randomId: '12345',
          state: 'prepared' as const
        }
      ]
    }
    vault.save(state)
    const raw = readFileSync(file, 'utf8')
    expect(raw).not.toContain(TEST_SESSION)
    expect(raw).not.toContain('private reply')
    expect(vault.load()).toEqual(state)
  })

  it('migrates the encrypted identity-only v1 vault without inventing receipts', () => {
    const file = join(temporaryDirectory(), 'telegram-account.enc')
    const cipher = fakeCipher()
    const legacy = {
      schemaVersion: 1,
      account: null,
      session: null,
      groups: [],
      drafts: [],
      outbox: []
    }
    writeFileSync(file, cipher.encrypt(JSON.stringify(legacy)))
    expect(new TelegramAccountVault(file, cipher).load()).toEqual({
      ...emptyState(),
      schemaVersion: 2,
      inboundEvents: []
    })
  })

  it('fails closed when OS-backed encryption is unavailable and never writes plaintext', () => {
    const file = join(temporaryDirectory(), 'telegram-account.enc')
    const vault = new TelegramAccountVault(file, fakeCipher(false))
    expect(() => vault.save({ ...emptyState(), session: TEST_SESSION })).toThrow(TelegramVaultError)
    expect(vault.isSecureStorageAvailable()).toBe(false)
  })

  it('refuses symlinked vault files and malformed decrypted records', () => {
    const directory = temporaryDirectory()
    const target = join(directory, 'target.enc')
    const link = join(directory, 'telegram-account.enc')
    writeFileSync(target, 'cipher:e30=')
    symlinkSync(target, link)
    expect(() => new TelegramAccountVault(link, fakeCipher()).load()).toThrow(TelegramVaultError)

    const malformed = join(directory, 'malformed.enc')
    const encrypted = Buffer.from(
      `cipher:${Buffer.from('{"schemaVersion":1,"session":"unsafe"}').toString('base64')}`
    )
    writeFileSync(malformed, encrypted)
    expect(() => new TelegramAccountVault(malformed, fakeCipher()).load()).toThrow(
      TelegramVaultError
    )
  })
})
