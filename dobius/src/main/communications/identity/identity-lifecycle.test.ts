import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type * as Os from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const safeStorageMock = vi.hoisted(() => ({
  decryptString: vi.fn((value: Buffer) => value.toString('utf8')),
  encryptString: vi.fn((value: string) => Buffer.from(value)),
  isEncryptionAvailable: vi.fn(() => true)
}))

const appMock = vi.hoisted(() => ({
  relaunch: vi.fn(),
  exit: vi.fn()
}))

let tempHome = ''

async function loadModules() {
  vi.resetModules()
  appMock.relaunch.mockClear()
  appMock.exit.mockClear()
  vi.doMock('electron', () => ({ safeStorage: safeStorageMock, app: appMock }))
  vi.doMock('os', async () => {
    const actual = await vi.importActual<typeof Os>('os')
    return { ...actual, homedir: () => tempHome }
  })
  const store = await import('../participant-identity-store')
  const lifecycle = await import('./identity-lifecycle')
  return { store, lifecycle }
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'dobius-identity-lifecycle-'))
})

describe('identity-lifecycle', () => {
  it('persistCurrentIdentity ensures an identity exists and maps it to the client Identity shape', async () => {
    const { lifecycle } = await loadModules()
    const identity = lifecycle.persistCurrentIdentity()

    expect(identity.pubkey).toMatch(/^[0-9a-f]{64}$/)
    expect(identity.storage).toBe('system-keyring')
    expect(identity).toEqual(
      expect.objectContaining({ lost: false, locked: false, resetFailed: false })
    )
  })

  it('falls back to local-file storage reporting when safeStorage is unavailable', async () => {
    safeStorageMock.isEncryptionAvailable.mockReturnValueOnce(false)
    const { lifecycle } = await loadModules()
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false)

    expect(lifecycle.persistCurrentIdentity().storage).toBe('local-file')
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
  })

  it('getLegacyWorkspaceStorage always returns an empty snapshot (no Sprout predecessor to migrate)', async () => {
    const { lifecycle } = await loadModules()
    expect(lifecycle.getLegacyWorkspaceStorage()).toEqual({
      workspaces: null,
      activeWorkspaceId: null,
      onboardingCompletions: []
    })
  })

  it('signOut wipes the stored identity so the next ensure generates a fresh one', async () => {
    const { store, lifecycle } = await loadModules()
    const before = store.ensureParticipantIdentity()

    lifecycle.signOut({ relaunch: false })

    expect(store.hasParticipantIdentity()).toBe(false)
    const after = store.ensureParticipantIdentity()
    expect(after.pubkey).not.toBe(before.pubkey)
  })

  it('signOut relaunches the app by default', async () => {
    const { store, lifecycle } = await loadModules()
    store.ensureParticipantIdentity()

    lifecycle.signOut()

    expect(appMock.relaunch).toHaveBeenCalledTimes(1)
    expect(appMock.exit).toHaveBeenCalledTimes(1)
  })

  it('signNostrIdentityBinding returns a schnorr signature that verifies against the participant pubkey', async () => {
    const { store, lifecycle } = await loadModules()
    const identity = store.ensureParticipantIdentity()

    const raw = lifecycle.signNostrIdentityBinding({
      challengeId: 'chal-1',
      nonce: 'nonce-1',
      verificationCode: '123456',
      origin: 'https://example.test',
      expiresAt: '2026-01-01T00:00:00Z'
    })
    const parsed = JSON.parse(raw) as { pubkey: string; sig: string; canonical: string }
    expect(parsed.pubkey).toBe(identity.pubkey)

    const { schnorr } = await import('@noble/curves/secp256k1')
    const { sha256 } = await import('@noble/hashes/sha256')
    const digest = sha256(new TextEncoder().encode(parsed.canonical))
    expect(schnorr.verify(parsed.sig, digest, parsed.pubkey)).toBe(true)
  })
})
