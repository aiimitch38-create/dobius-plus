import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type * as Os from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const safeStorageMock = vi.hoisted(() => ({
  decryptString: vi.fn((value: Buffer) => value.toString('utf8')),
  encryptString: vi.fn((value: string) => Buffer.from(value)),
  isEncryptionAvailable: vi.fn(() => true)
}))

const dialogMock = vi.hoisted(() => ({
  showSaveDialog: vi.fn()
}))

const secureWindowMock = vi.hoisted(() => ({
  revealNsecInSecureWindow: vi.fn(async () => undefined),
  promptForIdentityImport: vi.fn()
}))

let tempHome = ''

async function loadModules() {
  vi.resetModules()
  safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
  dialogMock.showSaveDialog.mockReset()
  secureWindowMock.revealNsecInSecureWindow.mockClear()
  secureWindowMock.promptForIdentityImport.mockReset()

  vi.doMock('electron', () => ({ safeStorage: safeStorageMock, dialog: dialogMock }))
  vi.doMock('os', async () => {
    const actual = await vi.importActual<typeof Os>('os')
    return { ...actual, homedir: () => tempHome }
  })
  vi.doMock('./secure-key-entry-window', () => secureWindowMock)

  const store = await import('../participant-identity-store')
  const { encodeNsec } = await import('./nip19-codec')
  const exportImport = await import('./identity-export-import')
  return { store, encodeNsec, exportImport }
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'dobius-identity-export-import-'))
})

describe('identity-export-import', () => {
  it('exportNsecViaSecureWindow reveals the current identity encoded as nsec, never as raw hex', async () => {
    const { store, encodeNsec, exportImport } = await loadModules()
    const identity = store.ensureParticipantIdentity()
    const { privateKeyHex } = store.unsafeGetParticipantPrivateKeyForCrypto()

    const result = await exportImport.exportNsecViaSecureWindow()

    expect(result).toEqual({ shown: true })
    expect(secureWindowMock.revealNsecInSecureWindow).toHaveBeenCalledWith(
      encodeNsec(privateKeyHex),
      identity.pubkey
    )
  })

  it('importIdentityViaSecureWindow stores a pasted nsec and returns the resulting public identity', async () => {
    const { store, encodeNsec, exportImport } = await loadModules()
    const { schnorr } = await import('@noble/curves/secp256k1')
    const freshPrivateKey = Buffer.from(schnorr.utils.randomPrivateKey()).toString('hex')
    const freshPubkey = Buffer.from(schnorr.getPublicKey(Buffer.from(freshPrivateKey, 'hex'))).toString('hex')

    secureWindowMock.promptForIdentityImport.mockResolvedValue({
      cancelled: false,
      input: encodeNsec(freshPrivateKey),
      password: ''
    })

    const outcome = await exportImport.importIdentityViaSecureWindow()

    expect(outcome).toEqual({
      cancelled: false,
      identity: expect.objectContaining({ pubkey: freshPubkey })
    })
    expect(store.unsafeGetParticipantPrivateKeyForCrypto().privateKeyHex).toBe(freshPrivateKey)
  })

  it('importIdentityViaSecureWindow accepts an ncryptsec backup + password', async () => {
    const { store, exportImport } = await loadModules()
    store.ensureParticipantIdentity()
    const { privateKeyHex } = store.unsafeGetParticipantPrivateKeyForCrypto()
    const { encryptToNcryptsec } = await import('./nip49-ncryptsec')
    const ncryptsec = await encryptToNcryptsec(privateKeyHex, 'backup-password', { logN: 4 })

    secureWindowMock.promptForIdentityImport.mockResolvedValue({
      cancelled: false,
      input: ncryptsec,
      password: 'backup-password'
    })

    const outcome = await exportImport.importIdentityViaSecureWindow()
    expect(outcome.cancelled).toBe(false)
    expect(store.unsafeGetParticipantPrivateKeyForCrypto().privateKeyHex).toBe(privateKeyHex)
  })

  it('importIdentityViaSecureWindow reports cancellation without touching the store', async () => {
    const { store, exportImport } = await loadModules()
    const before = store.ensureParticipantIdentity()
    secureWindowMock.promptForIdentityImport.mockResolvedValue({ cancelled: true })

    const outcome = await exportImport.importIdentityViaSecureWindow()

    expect(outcome).toEqual({ cancelled: true })
    expect(store.getParticipantPublicIdentity()).toEqual(before)
  })

  it(
    'createNcryptsecBackup -> verifyNcryptsecBackup round-trips and reports matchesCurrentIdentity',
    async () => {
      const { store, exportImport } = await loadModules()
      const identity = store.ensureParticipantIdentity()

      // Uses the production default (scrypt N=2^16 via createNcryptsecBackup's
      // own default, not the tests' FAST_OPTIONS shortcut) — deliberately slow,
      // hence the longer per-test timeout below.
      const backup = await exportImport.createNcryptsecBackup('pw')
      const verification = await exportImport.verifyNcryptsecBackup(backup, 'pw')

      expect(verification.pubkey).toBe(identity.pubkey)
      expect(verification.npub.startsWith('npub1')).toBe(true)
      expect(verification.matchesCurrentIdentity).toBe(true)
    },
    20_000
  )

  it('verifyNcryptsecBackup reports matchesCurrentIdentity=false for a backup of a different identity', async () => {
    const { store, exportImport } = await loadModules()
    store.ensureParticipantIdentity()

    const { schnorr } = await import('@noble/curves/secp256k1')
    const otherKey = Buffer.from(schnorr.utils.randomPrivateKey()).toString('hex')
    const { encryptToNcryptsec } = await import('./nip49-ncryptsec')
    const otherBackup = await encryptToNcryptsec(otherKey, 'pw', { logN: 4 })

    const verification = await exportImport.verifyNcryptsecBackup(otherBackup, 'pw')
    expect(verification.matchesCurrentIdentity).toBe(false)
  })

  it(
    'verifyNcryptsecBackup rejects the wrong password',
    async () => {
      const { store, exportImport } = await loadModules()
      store.ensureParticipantIdentity()
      const backup = await exportImport.createNcryptsecBackup('right-pw')

      await expect(exportImport.verifyNcryptsecBackup(backup, 'wrong-pw')).rejects.toThrow()
    },
    20_000
  )

  it('saveNcryptsecCopy writes the already-encrypted blob to the chosen path', async () => {
    const { exportImport } = await loadModules()
    const targetPath = join(tempHome, 'backup.ncryptsec.txt')
    dialogMock.showSaveDialog.mockResolvedValue({ canceled: false, filePath: targetPath })

    const result = await exportImport.saveNcryptsecCopy('ncryptsec1fakevalue')

    expect(result).toBe(targetPath)
    expect(readFileSync(targetPath, 'utf8')).toBe('ncryptsec1fakevalue')
  })

  it('saveNcryptsecCopy returns null when the native dialog is cancelled', async () => {
    const { exportImport } = await loadModules()
    dialogMock.showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })

    expect(await exportImport.saveNcryptsecCopy('ncryptsec1fakevalue')).toBeNull()
  })
})
