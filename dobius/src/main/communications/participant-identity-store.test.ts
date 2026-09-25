import { schnorr } from '@noble/curves/secp256k1'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'node:fs'
import type * as Fs from 'node:fs'
import { tmpdir } from 'node:os'
import type * as Os from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Fake ciphertext that, like real safeStorage output, is not parseable JSON
// and cannot be decrypted without the prefix.
const { safeStorageMock, fakeDecrypt } = vi.hoisted(() => {
  const decrypt = (value: Buffer): string => {
    const text = value.toString('utf8')
    if (!text.startsWith('ENC:')) {throw new Error('Error while decrypting the ciphertext provided')}
    return text.slice('ENC:'.length)
  }
  return {
    fakeDecrypt: decrypt,
    safeStorageMock: {
      decryptString: vi.fn(decrypt),
      encryptString: vi.fn((value: string) => Buffer.from(`ENC:${value}`)),
      isEncryptionAvailable: vi.fn(() => true)
    }
  }
})

// Pass-through node:fs with one-shot fault injection for the store under test.
const fsFaults = vi.hoisted(() => ({ renameError: null as NodeJS.ErrnoException | null }))

let tempHome = ''

async function loadStoreModule(options: { brokenUserInfo?: boolean } = {}) {
  vi.resetModules()
  vi.doMock('electron', () => ({ safeStorage: safeStorageMock }))
  vi.doMock('os', async () => {
    const actual = await vi.importActual<typeof Os>('os')
    return {
      ...actual,
      homedir: () => tempHome,
      // Regression coverage for a real sandbox failure mode: getpwuid
      // (what os.userInfo() calls) can throw instead of returning an empty
      // username when the OS's directory-services lookup is unreachable.
      userInfo: options.brokenUserInfo
        ? () => {
            throw new Error('uv_os_get_passwd returned ENOENT (no such file or directory)')
          }
        : actual.userInfo
    }
  })
  vi.doMock('node:fs', async () => {
    const actual = await vi.importActual<typeof Fs>('node:fs')
    return {
      ...actual,
      renameSync: (from: Fs.PathLike, to: Fs.PathLike) => {
        const fault = fsFaults.renameError
        if (fault) {
          fsFaults.renameError = null
          throw fault
        }
        actual.renameSync(from, to)
      }
    }
  })
  return import('./participant-identity-store')
}

function identityPath(): string {
  return join(tempHome, '.dobius', 'communications-identity.enc')
}

function dobiusDirListing(): string[] {
  return readdirSync(join(tempHome, '.dobius')).sort()
}

function decryptFailsOnce(): void {
  safeStorageMock.decryptString.mockImplementationOnce(() => {
    throw new Error('The user name or passphrase you entered is not correct.')
  })
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'dobius-communications-identity-'))
  safeStorageMock.decryptString.mockReset()
  safeStorageMock.decryptString.mockImplementation(fakeDecrypt)
  safeStorageMock.encryptString.mockClear()
  safeStorageMock.isEncryptionAvailable.mockClear()
  safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
  fsFaults.renameError = null
})

describe('participant identity store', () => {
  it('reports missing status without creating storage files', async () => {
    const store = await loadStoreModule()

    expect(store.hasParticipantIdentity()).toBe(false)
    expect(existsSync(join(tempHome, '.dobius'))).toBe(false)
  })

  it('generates and persists an identity on first ensure, returning only public fields', async () => {
    const store = await loadStoreModule()

    const identity = store.ensureParticipantIdentity()

    expect(identity).toEqual({ pubkey: expect.any(String), username: expect.any(String) })
    expect(identity).not.toHaveProperty('privateKeyHex')
    expect(identity.pubkey).toMatch(/^[0-9a-f]{64}$/)
    expect(store.hasParticipantIdentity()).toBe(true)
  })

  it('returns the same identity on repeated ensure calls instead of regenerating', async () => {
    const store = await loadStoreModule()

    const first = store.ensureParticipantIdentity()
    const second = store.ensureParticipantIdentity()

    expect(second).toEqual(first)
  })

  it('throws from getParticipantPublicIdentity when no identity has been created', async () => {
    const store = await loadStoreModule()

    expect(() => store.getParticipantPublicIdentity()).toThrow(
      'Communications participant identity is not configured'
    )
  })

  it('throws from signParticipantEvent when no identity has been created', async () => {
    const store = await loadStoreModule()

    expect(() => store.signParticipantEvent({ kind: 1, content: 'hi', tags: [] })).toThrow(
      'Communications participant identity is not configured'
    )
  })

  it('signs an event that verifies against the participant public key with real BIP-340 verification', async () => {
    const store = await loadStoreModule()
    const identity = store.ensureParticipantIdentity()

    const signed = store.signParticipantEvent({
      kind: 1,
      content: 'hello communications',
      tags: [['h', 'general']],
      createdAt: 1_700_000_000
    })

    expect(signed.pubkey).toBe(identity.pubkey)
    expect(signed).not.toHaveProperty('privateKeyHex')
    expect(schnorr.verify(signed.sig, signed.id, signed.pubkey)).toBe(true)
  })

  it('recomputes the same event id independently to confirm NIP-01 serialization', async () => {
    const store = await loadStoreModule()
    const identity = store.ensureParticipantIdentity()

    const signed = store.signParticipantEvent({
      kind: 1,
      content: 'hello communications',
      tags: [['h', 'general']],
      createdAt: 1_700_000_000
    })

    const { sha256 } = await import('@noble/hashes/sha256')
    const expectedSerialized = JSON.stringify([
      0,
      identity.pubkey,
      1_700_000_000,
      1,
      [['h', 'general']],
      'hello communications'
    ])
    const expectedId = Buffer.from(sha256(new TextEncoder().encode(expectedSerialized))).toString('hex')
    expect(signed.id).toBe(expectedId)
  })

  it('falls back to plaintext storage when safeStorage encryption is unavailable, and still round-trips', async () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const store = await loadStoreModule()

    const identity = store.ensureParticipantIdentity()
    expect(safeStorageMock.encryptString).not.toHaveBeenCalled()

    // Force a fresh read from disk by loading a new module instance.
    const reloaded = await loadStoreModule()
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    expect(reloaded.getParticipantPublicIdentity()).toEqual(identity)
    expect(safeStorageMock.decryptString).not.toHaveBeenCalled()
  })

  it('clears the identity so a subsequent ensure generates a different keypair', async () => {
    const store = await loadStoreModule()
    const first = store.ensureParticipantIdentity()

    store.clearParticipantIdentity()
    expect(store.hasParticipantIdentity()).toBe(false)

    const second = store.ensureParticipantIdentity()
    expect(second.pubkey).not.toBe(first.pubkey)
  })

  it('falls back to a default username instead of throwing when os.userInfo() fails', async () => {
    const store = await loadStoreModule({ brokenUserInfo: true })

    const identity = store.ensureParticipantIdentity()

    expect(identity.username).toBe('dobius')
    expect(identity.pubkey).toMatch(/^[0-9a-f]{64}$/)
  })

  it('importParticipantPrivateKey also falls back to a default username when os.userInfo() fails', async () => {
    const store = await loadStoreModule({ brokenUserInfo: true })
    const privateKeyHex = Buffer.from(schnorr.utils.randomPrivateKey()).toString('hex')

    const identity = store.importParticipantPrivateKey(privateKeyHex)

    expect(identity.username).toBe('dobius')
  })

  it('fails closed on a transient decrypt failure and keeps the same identity', async () => {
    const store = await loadStoreModule()
    const original = store.ensureParticipantIdentity()
    const bytesBefore = readFileSync(identityPath())
    const listingBefore = dobiusDirListing()

    const reloaded = await loadStoreModule()
    decryptFailsOnce()
    expect(() => reloaded.ensureParticipantIdentity()).toThrow(reloaded.ParticipantIdentityUnavailableError)
    expect(safeStorageMock.encryptString).toHaveBeenCalledTimes(1)
    expect(readFileSync(identityPath()).equals(bytesBefore)).toBe(true)
    expect(dobiusDirListing()).toEqual(listingBefore)

    // Keychain access is back: the very same identity, no restart needed.
    expect(reloaded.ensureParticipantIdentity()).toEqual(original)
    expect(readFileSync(identityPath()).equals(bytesBefore)).toBe(true)
  })

  it('fails closed while encryption is transiently unavailable for an encrypted identity', async () => {
    const store = await loadStoreModule()
    const original = store.ensureParticipantIdentity()
    const bytesBefore = readFileSync(identityPath())

    const reloaded = await loadStoreModule()
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    expect(() => reloaded.ensureParticipantIdentity()).toThrow(/unavailable \(encryption unavailable\)/)
    expect(() => reloaded.getParticipantPublicIdentity()).toThrow(reloaded.ParticipantIdentityUnavailableError)
    expect(() => reloaded.signParticipantEvent({ kind: 1, content: 'x', tags: [] })).toThrow(
      reloaded.ParticipantIdentityUnavailableError
    )
    expect(readFileSync(identityPath()).equals(bytesBefore)).toBe(true)

    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    expect(reloaded.ensureParticipantIdentity()).toEqual(original)
  })

  it.each([
    ['a read error', () => chmodSync(identityPath(), 0o000), /unavailable \(EACCES\)/],
    ['a corrupt file', () => writeFileSync(identityPath(), 'ENC:{not json'), /unexpected identity shape/],
    [
      'a file with the wrong shape',
      () => writeFileSync(identityPath(), 'ENC:{"pubkeyHex":"ab"}'),
      /unexpected identity shape/
    ]
  ])('never replaces the identity after %s', async (_label, breakFile, message) => {
    const store = await loadStoreModule()
    store.ensureParticipantIdentity()
    breakFile()
    const brokenMode = statSync(identityPath()).mode & 0o777
    chmodSync(identityPath(), 0o600)
    const bytesBefore = readFileSync(identityPath())
    chmodSync(identityPath(), brokenMode)
    const listingBefore = dobiusDirListing()

    const reloaded = await loadStoreModule()
    expect(() => reloaded.ensureParticipantIdentity()).toThrow(message)
    expect(() => reloaded.ensureParticipantIdentity()).toThrow(message)
    chmodSync(identityPath(), 0o600)
    expect(readFileSync(identityPath()).equals(bytesBefore)).toBe(true)
    expect(dobiusDirListing()).toEqual(listingBefore)
  })

  it('reads a legacy plaintext identity after encryption becomes available', async () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const store = await loadStoreModule()
    const original = store.ensureParticipantIdentity()

    const reloaded = await loadStoreModule()
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    expect(reloaded.ensureParticipantIdentity()).toEqual(original)
  })

  it('keeps the previous identity file when a write is interrupted', async () => {
    const store = await loadStoreModule()
    const original = store.ensureParticipantIdentity()
    const bytesBefore = readFileSync(identityPath())
    const listingBefore = dobiusDirListing()
    const replacementKey = Buffer.from(schnorr.utils.randomPrivateKey()).toString('hex')

    fsFaults.renameError = Object.assign(new Error('simulated crash before rename'), { code: 'EIO' })
    expect(() => store.importParticipantPrivateKey(replacementKey)).toThrow(/simulated crash/)

    expect(readFileSync(identityPath()).equals(bytesBefore)).toBe(true)
    expect(dobiusDirListing()).toEqual(listingBefore)
    const reloaded = await loadStoreModule()
    expect(reloaded.getParticipantPublicIdentity()).toEqual(original)
  })

  it('explicit sign-out reset replaces an unavailable identity with a new one', async () => {
    const store = await loadStoreModule()
    const original = store.ensureParticipantIdentity()

    const reloaded = await loadStoreModule()
    safeStorageMock.decryptString.mockImplementation(() => {
      throw new Error('The user name or passphrase you entered is not correct.')
    })
    expect(() => reloaded.ensureParticipantIdentity()).toThrow(reloaded.ParticipantIdentityUnavailableError)

    const unavailableBytes = readFileSync(identityPath())
    reloaded.clearParticipantIdentity()
    // The possibly only-temporarily-unreadable key is kept, never deleted.
    const kept = dobiusDirListing().filter((name) => name.includes('.signed-out-'))
    expect(kept).toHaveLength(1)
    expect(readFileSync(join(tempHome, '.dobius', kept[0] as string)).equals(unavailableBytes)).toBe(true)

    const fresh = reloaded.ensureParticipantIdentity()
    expect(fresh.pubkey).toMatch(/^[a-f0-9]{64}$/)
    expect(fresh.pubkey).not.toBe(original.pubkey)
  })

  it('refuses sign-out when the identity file cannot be kept aside, and deletes nothing', async () => {
    const store = await loadStoreModule()
    const original = store.ensureParticipantIdentity()
    const bytesBefore = readFileSync(identityPath())
    const listingBefore = dobiusDirListing()

    fsFaults.renameError = Object.assign(new Error('permission denied'), { code: 'EPERM' })
    expect(() => store.clearParticipantIdentity()).toThrow(/Sign-out refused.*EPERM/)
    expect(readFileSync(identityPath()).equals(bytesBefore)).toBe(true)
    expect(dobiusDirListing()).toEqual(listingBefore)
    expect(store.ensureParticipantIdentity()).toEqual(original)
  })

  it('sign-out on a machine with no identity file is a no-op', async () => {
    const store = await loadStoreModule()
    expect(() => store.clearParticipantIdentity()).not.toThrow()
  })

  it('an explicit import over an unavailable identity keeps the old file aside first', async () => {
    const store = await loadStoreModule()
    store.ensureParticipantIdentity()
    const oldBytes = readFileSync(identityPath())

    const reloaded = await loadStoreModule()
    decryptFailsOnce()
    const replacementKey = Buffer.from(schnorr.utils.randomPrivateKey()).toString('hex')
    const imported = reloaded.importParticipantPrivateKey(replacementKey, 'carson')

    expect(imported.username).toBe('carson')
    const kept = dobiusDirListing().filter((name) => name.includes('.unavailable-'))
    expect(kept).toHaveLength(1)
    expect(readFileSync(join(tempHome, '.dobius', kept[0] as string)).equals(oldBytes)).toBe(true)
    expect(reloaded.getParticipantPublicIdentity()).toEqual(imported)
  })
})
