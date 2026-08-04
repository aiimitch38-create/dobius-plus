import { schnorr } from '@noble/curves/secp256k1'
import { existsSync, mkdtempSync } from 'node:fs'
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
  vi.doMock('electron', () => ({ safeStorage: safeStorageMock }))
  vi.doMock('os', async () => {
    const actual = await vi.importActual<typeof Os>('os')
    return { ...actual, homedir: () => tempHome }
  })
  return import('./participant-identity-store')
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'dobius-communications-identity-'))
  safeStorageMock.decryptString.mockClear()
  safeStorageMock.encryptString.mockClear()
  safeStorageMock.isEncryptionAvailable.mockClear()
  safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
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
})
