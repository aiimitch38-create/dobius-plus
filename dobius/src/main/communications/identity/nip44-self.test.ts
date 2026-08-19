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

let tempHome = ''

async function loadModules() {
  vi.resetModules()
  vi.doMock('electron', () => ({ safeStorage: safeStorageMock }))
  vi.doMock('os', async () => {
    const actual = await vi.importActual<typeof Os>('os')
    return { ...actual, homedir: () => tempHome }
  })
  const store = await import('../participant-identity-store')
  const nip44 = await import('./nip44-self')
  return { store, nip44 }
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'dobius-nip44-self-'))
})

describe('nip44-self', () => {
  it('round-trips plaintext through encrypt-to-self / decrypt-from-self', async () => {
    const { store, nip44 } = await loadModules()
    store.ensureParticipantIdentity()

    const payload = nip44.nip44EncryptToSelf('a secret note to myself')
    expect(nip44.nip44DecryptFromSelf(payload)).toBe('a secret note to myself')
  })

  it('never lets the plaintext or the private key leak into the base64 payload', async () => {
    const { store, nip44 } = await loadModules()
    store.ensureParticipantIdentity()
    const { privateKeyHex } = store.unsafeGetParticipantPrivateKeyForCrypto()

    const payload = nip44.nip44EncryptToSelf('sensitive-marker-value')
    expect(payload).not.toContain('sensitive-marker-value')
    expect(payload).not.toContain(privateKeyHex)
  })

  it('produces a different payload each time (fresh random nonce)', async () => {
    const { store, nip44 } = await loadModules()
    store.ensureParticipantIdentity()

    const a = nip44.nip44EncryptToSelf('same message')
    const b = nip44.nip44EncryptToSelf('same message')
    expect(a).not.toBe(b)
    expect(nip44.nip44DecryptFromSelf(a)).toBe('same message')
    expect(nip44.nip44DecryptFromSelf(b)).toBe('same message')
  })

  it('rejects a tampered payload instead of returning corrupted plaintext', async () => {
    const { store, nip44 } = await loadModules()
    store.ensureParticipantIdentity()

    const payload = nip44.nip44EncryptToSelf('do not tamper with me')
    const raw = Buffer.from(payload, 'base64')
    raw[raw.length - 1] ^= 0xff
    const tampered = raw.toString('base64')

    expect(() => nip44.nip44DecryptFromSelf(tampered)).toThrow(/MAC verification failed/)
  })

  it('handles plaintext at both ends of the padding boundary', async () => {
    const { store, nip44 } = await loadModules()
    store.ensureParticipantIdentity()

    const short = 'x'
    const long = 'y'.repeat(1000)
    expect(nip44.nip44DecryptFromSelf(nip44.nip44EncryptToSelf(short))).toBe(short)
    expect(nip44.nip44DecryptFromSelf(nip44.nip44EncryptToSelf(long))).toBe(long)
  })
})
