// Export/import/backup orchestration — the highest-stakes file in this
// slice. See KEY_SAFETY in the build report for the full threat-model
// writeup; the short version:
//   - exportNsecViaSecureWindow / importIdentityViaSecureWindow move the raw
//     key through secure-key-entry-window.ts's own trusted window only.
//   - createNcryptsecBackup / verifyNcryptsecBackup return an AEAD-encrypted
//     blob or a boolean — never the decoded key — so it's safe for these to
//     cross into the renderer, matching Buzz's own contract.
//   - saveNcryptsecCopy writes an already-encrypted blob straight to disk
//     via a native dialog; the renderer only learns the chosen path.
import { dialog } from 'electron'
import {
  getParticipantPublicIdentity,
  importParticipantPrivateKey,
  unsafeGetParticipantPrivateKeyForCrypto
} from '../participant-identity-store'
import { decodeNsec, encodeNpub, encodeNsec, looksLikeNsec } from './nip19-codec'
import { decryptNcryptsec, encryptToNcryptsec } from './nip49-ncryptsec'
import { promptForIdentityImport, revealNsecInSecureWindow } from './secure-key-entry-window'
import type { Identity } from './identity-lifecycle'

/**
 * Opens the trusted reveal window with the current identity's nsec. Returns
 * only a boolean — the key itself never crosses back into an IPC reply.
 */
export async function exportNsecViaSecureWindow(): Promise<{ shown: true }> {
  const { privateKeyHex, pubkeyHex } = unsafeGetParticipantPrivateKeyForCrypto()
  await revealNsecInSecureWindow(encodeNsec(privateKeyHex), pubkeyHex)
  return { shown: true }
}

export type ImportIdentityOutcome = { cancelled: true } | { cancelled: false; identity: Identity }

/**
 * Opens the trusted import window, resolves whatever the user typed (a raw
 * nsec, or an ncryptsec backup + password) into a private key entirely in
 * main process memory, and persists it via the Keychain-backed store.
 */
export async function importIdentityViaSecureWindow(): Promise<ImportIdentityOutcome> {
  const prompt = await promptForIdentityImport()
  if (prompt.cancelled) {
    return { cancelled: true }
  }

  let privateKeyHex: string
  if (looksLikeNsec(prompt.input)) {
    privateKeyHex = decodeNsec(prompt.input)
  } else {
    const decrypted = await decryptNcryptsec(prompt.input, prompt.password)
    privateKeyHex = decrypted.privateKeyHex
  }

  const publicIdentity = importParticipantPrivateKey(privateKeyHex)
  return {
    cancelled: false,
    identity: {
      pubkey: publicIdentity.pubkey,
      displayName: publicIdentity.username,
      storage: undefined,
      lost: false,
      locked: false,
      resetFailed: false
    }
  }
}

/** Encrypts the current identity's private key into a portable `ncryptsec1...` backup string. */
export async function createNcryptsecBackup(password: string): Promise<string> {
  const { privateKeyHex } = unsafeGetParticipantPrivateKeyForCrypto()
  return encryptToNcryptsec(privateKeyHex, password)
}

/**
 * Writes an already-encrypted ncryptsec string to a user-chosen file via a
 * native save dialog. Returns the chosen path, or null if cancelled.
 */
export async function saveNcryptsecCopy(ncryptsec: string): Promise<string | null> {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Save Communications identity backup',
    defaultPath: 'communications-identity-backup.ncryptsec.txt',
    filters: [{ name: 'Nostr encrypted backup', extensions: ['txt'] }]
  })
  if (canceled || !filePath) {
    return null
  }
  const { writeFile } = await import('node:fs/promises')
  await writeFile(filePath, ncryptsec, { mode: 0o600 })
  return filePath
}

export type BackupVerification = {
  pubkey: string
  npub: string
  matchesCurrentIdentity: boolean
}

/** Decrypts an ncryptsec backup locally and returns only its public identity and match state. */
export async function verifyNcryptsecBackup(ncryptsec: string, password: string): Promise<BackupVerification> {
  const decrypted = await decryptNcryptsec(ncryptsec, password)
  const { schnorr } = await import('@noble/curves/secp256k1')
  const pubkeyHex = Buffer.from(schnorr.getPublicKey(Buffer.from(decrypted.privateKeyHex, 'hex'))).toString('hex')

  let matchesCurrentIdentity = false
  try {
    matchesCurrentIdentity = getParticipantPublicIdentity().pubkey === pubkeyHex
  } catch {
    matchesCurrentIdentity = false
  }

  return { pubkey: pubkeyHex, npub: encodeNpub(pubkeyHex), matchesCurrentIdentity }
}
