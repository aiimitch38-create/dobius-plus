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

async function loadStoreModule() {
  vi.resetModules()
  vi.doMock('electron', () => ({ safeStorage: safeStorageMock }))
  vi.doMock('os', async () => {
    const actual = await vi.importActual<typeof Os>('os')
    return { ...actual, homedir: () => tempHome }
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
  return import('./agent-participant-identity-store')
}

function registryPath(): string {
  return join(tempHome, '.dobius', 'communications-agent-identities.enc')
}

function dobiusDirListing(): string[] {
  return readdirSync(join(tempHome, '.dobius')).sort()
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'dobius-agent-identity-'))
  safeStorageMock.decryptString.mockReset()
  safeStorageMock.decryptString.mockImplementation(fakeDecrypt)
  safeStorageMock.encryptString.mockClear()
  safeStorageMock.isEncryptionAvailable.mockClear()
  safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
  fsFaults.renameError = null
})

describe('agent participant identity store', () => {
  it('creates no file until an agent identity is requested', async () => {
    await loadStoreModule()
    expect(existsSync(join(tempHome, '.dobius'))).toBe(false)
  })

  it('generates a stable pubkey per agent id, distinct across agents', async () => {
    const store = await loadStoreModule()
    const a1 = store.ensureAgentIdentity('agent-1')
    const a1Again = store.ensureAgentIdentity('agent-1')
    const a2 = store.ensureAgentIdentity('agent-2')

    expect(a1.pubkey).toMatch(/^[a-f0-9]{64}$/)
    expect(a1Again.pubkey).toBe(a1.pubkey)
    expect(a2.pubkey).not.toBe(a1.pubkey)
  })

  it('persists identities to disk encrypted, and reloads them in a fresh module instance', async () => {
    const store = await loadStoreModule()
    const created = store.ensureAgentIdentity('agent-1')
    expect(safeStorageMock.encryptString).toHaveBeenCalled()

    const reloaded = await loadStoreModule()
    const reread = reloaded.ensureAgentIdentity('agent-1')
    expect(reread.pubkey).toBe(created.pubkey)
  })

  it('signs an event whose id and signature verify against the agent pubkey', async () => {
    const store = await loadStoreModule()
    const { pubkey } = store.ensureAgentIdentity('agent-1')

    const signed = store.signAsAgent('agent-1', {
      kind: 9,
      content: 'hello from the agent',
      tags: [['h', 'channel-1']]
    })

    expect(signed.pubkey).toBe(pubkey)
    const idBytes = Buffer.from(
      require('@noble/hashes/sha256').sha256(
        new TextEncoder().encode(
          JSON.stringify([0, signed.pubkey, signed.created_at, signed.kind, signed.tags, signed.content])
        )
      )
    )
    expect(signed.id).toBe(idBytes.toString('hex'))
    expect(
      schnorr.verify(signed.sig, Buffer.from(signed.id, 'hex'), Buffer.from(signed.pubkey, 'hex'))
    ).toBe(true)
  })

  it('throws when signing for an agent with no identity yet', async () => {
    const store = await loadStoreModule()
    expect(() => store.signAsAgent('unknown-agent', { kind: 9, content: 'x', tags: [] })).toThrow(
      /No Communications identity/
    )
  })

  it('clearAgentIdentityRegistry removes the on-disk file and cache', async () => {
    const store = await loadStoreModule()
    store.ensureAgentIdentity('agent-1')
    store.clearAgentIdentityRegistry()
    expect(existsSync(join(tempHome, '.dobius', 'communications-agent-identities.enc'))).toBe(false)
  })

  it('fails closed on a transient decrypt failure and keeps every agent identity', async () => {
    const store = await loadStoreModule()
    const original = store.ensureAgentIdentity('agent-1')
    const bytesBefore = readFileSync(registryPath())
    const listingBefore = dobiusDirListing()

    const reloaded = await loadStoreModule()
    safeStorageMock.decryptString.mockImplementationOnce(() => {
      throw new Error('The user name or passphrase you entered is not correct.')
    })
    expect(() => reloaded.ensureAgentIdentity('agent-1')).toThrow(
      reloaded.AgentIdentityRegistryUnavailableError
    )
    expect(safeStorageMock.encryptString).toHaveBeenCalledTimes(1)
    expect(readFileSync(registryPath()).equals(bytesBefore)).toBe(true)
    expect(dobiusDirListing()).toEqual(listingBefore)

    // Keychain access is back: the same agent identity, no restart needed.
    expect(reloaded.ensureAgentIdentity('agent-1')).toEqual(original)
  })

  it('does not create a new agent identity while the registry is unavailable', async () => {
    const store = await loadStoreModule()
    store.ensureAgentIdentity('agent-1')
    const bytesBefore = readFileSync(registryPath())

    const reloaded = await loadStoreModule()
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    expect(() => reloaded.ensureAgentIdentity('agent-2')).toThrow(/unavailable \(encryption unavailable\)/)
    expect(() => reloaded.signAsAgent('agent-1', { kind: 9, content: 'x', tags: [] })).toThrow(
      reloaded.AgentIdentityRegistryUnavailableError
    )
    expect(readFileSync(registryPath()).equals(bytesBefore)).toBe(true)
  })

  it.each([
    ['a read error', () => chmodSync(registryPath(), 0o000), /unavailable \(EACCES\)/],
    ['a corrupt file', () => writeFileSync(registryPath(), 'ENC:{not json'), /unexpected registry shape/],
    [
      'an entry with the wrong shape',
      () => writeFileSync(registryPath(), 'ENC:{"agent-1":{"pubkeyHex":"ab"}}'),
      /unexpected registry shape/
    ]
  ])('never replaces the registry after %s', async (_label, breakFile, message) => {
    const store = await loadStoreModule()
    store.ensureAgentIdentity('agent-1')
    breakFile()
    const brokenMode = statSync(registryPath()).mode & 0o777
    chmodSync(registryPath(), 0o600)
    const bytesBefore = readFileSync(registryPath())
    chmodSync(registryPath(), brokenMode)
    const listingBefore = dobiusDirListing()

    const reloaded = await loadStoreModule()
    expect(() => reloaded.ensureAgentIdentity('agent-1')).toThrow(message)
    expect(() => reloaded.ensureAgentIdentity('agent-2')).toThrow(message)
    chmodSync(registryPath(), 0o600)
    expect(readFileSync(registryPath()).equals(bytesBefore)).toBe(true)
    expect(dobiusDirListing()).toEqual(listingBefore)
  })

  it('reads a legacy plaintext registry after encryption becomes available', async () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)
    const store = await loadStoreModule()
    const original = store.ensureAgentIdentity('agent-1')

    const reloaded = await loadStoreModule()
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    expect(reloaded.ensureAgentIdentity('agent-1')).toEqual(original)
  })

  it('keeps the previous registry when a write is interrupted', async () => {
    const store = await loadStoreModule()
    const original = store.ensureAgentIdentity('agent-1')
    const bytesBefore = readFileSync(registryPath())
    const listingBefore = dobiusDirListing()

    fsFaults.renameError = Object.assign(new Error('simulated crash before rename'), { code: 'EIO' })
    expect(() => store.ensureAgentIdentity('agent-2')).toThrow(/simulated crash/)

    expect(readFileSync(registryPath()).equals(bytesBefore)).toBe(true)
    expect(dobiusDirListing()).toEqual(listingBefore)
    const reloaded = await loadStoreModule()
    expect(reloaded.ensureAgentIdentity('agent-1')).toEqual(original)
  })
})
