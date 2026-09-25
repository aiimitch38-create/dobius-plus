// Package 1 of plans/BUZZ-COMMUNICATIONS-TAKEOVER.md: the Communications
// participant's Nostr signing key currently lives as a raw hex string in the
// Buzz webview's localStorage (see dobiusCommunications.ts's `localIdentity`).
// This module is the replacement: the private key is generated, encrypted
// with Electron's safeStorage, and held only in the main process. Callers
// get back a signed event or the public identity — never the private key.
//
// ponytail: `@noble/curves`/`@noble/hashes` resolve today as transitive
// pnpm deps (the same libraries nostr-tools itself signs with), not a
// declared dependency of this package, because dobius/package.json is
// being actively edited by another terminal on this branch right now.
// Add them as direct dependencies once that file is free to touch.
import { schnorr } from '@noble/curves/secp256k1'
import { sha256 } from '@noble/hashes/sha256'
import { safeStorage } from 'electron'
import { existsSync, readFileSync, renameSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import { writeSecureFile } from '../../shared/secure-file'

const IDENTITY_FILE = 'communications-identity.enc'

type StoredParticipantIdentity = {
  privateKeyHex: string
  pubkeyHex: string
  username: string
}

export type ParticipantPublicIdentity = {
  pubkey: string
  username: string
}

export type UnsignedCommunicationsEvent = {
  kind: number
  content: string
  tags: string[][]
  createdAt?: number
}

export type SignedCommunicationsEvent = {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

let cachedIdentity: StoredParticipantIdentity | null = null
let lastLoggedUnavailableDetail: string | null = null

/**
 * The identity file exists but could not be read, decrypted or parsed. The
 * file is left exactly as it is; nothing generates a replacement identity.
 */
export class ParticipantIdentityUnavailableError extends Error {
  constructor(
    readonly filePath: string,
    readonly detail: string
  ) {
    super(
      `Communications participant identity is unavailable (${detail}); the file at ${filePath} ` +
        'was kept unchanged. Restore Keychain access, import a backup, or sign out to start a new identity.'
    )
    this.name = 'ParticipantIdentityUnavailableError'
  }
}

export type ParticipantIdentityCreatedListener = (identity: ParticipantPublicIdentity) => void

// Single-slot listener set by participant-identity-buzz-migration.ts so a
// freshly generated identity can get its kind-0 profile published without
// this module growing network code.
let identityCreatedListener: ParticipantIdentityCreatedListener | null = null

/**
 * Registers the callback fired when `ensureParticipantIdentity` generates a
 * brand-new identity. Never fires for reads of an existing identity or for
 * explicit imports (those flows publish profiles themselves).
 */
export function onParticipantIdentityCreated(listener: ParticipantIdentityCreatedListener): void {
  identityCreatedListener = listener
}

function getDobiusDir(): string {
  return join(homedir(), '.dobius')
}

function getIdentityPath(): string {
  return join(getDobiusDir(), IDENTITY_FILE)
}

function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex')
}

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, 'hex'))
}

function errorText(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {return String(error.code)}
  return error instanceof Error ? error.message : String(error)
}

function parseStoredIdentity(text: string): StoredParticipantIdentity | undefined {
  let parsed: Partial<StoredParticipantIdentity> | null
  try {
    parsed = JSON.parse(text) as Partial<StoredParticipantIdentity> | null
  } catch {
    return undefined
  }
  if (
    !parsed ||
    typeof parsed.privateKeyHex !== 'string' ||
    typeof parsed.pubkeyHex !== 'string' ||
    typeof parsed.username !== 'string'
  ) {
    return undefined
  }
  return parsed as StoredParticipantIdentity
}

// Returns the identity, or a short reason (never file contents) it could not be decoded.
function decodeStoredIdentity(raw: Buffer): StoredParticipantIdentity | string {
  let decryptProblem = 'encryption unavailable'
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return parseStoredIdentity(safeStorage.decryptString(raw)) ?? 'unexpected identity shape'
    } catch (error) {
      decryptProblem = `decrypt failed: ${errorText(error)}`
    }
  }
  // Why: a file written while encryption was unavailable is plaintext JSON.
  return parseStoredIdentity(raw.toString('utf8')) ?? decryptProblem
}

function unavailable(identityPath: string, detail: string): ParticipantIdentityUnavailableError {
  if (lastLoggedUnavailableDetail !== detail) {
    lastLoggedUnavailableDetail = detail
    console.error(
      `[participant-identity-store] participant identity unavailable (${identityPath}: ${detail}); ` +
        'keeping the file and refusing to generate a replacement'
    )
  }
  return new ParticipantIdentityUnavailableError(identityPath, detail)
}

/**
 * Null only when no identity file exists. Any other failure throws
 * ParticipantIdentityUnavailableError and is re-tried on the next call, so a
 * transient Keychain or read failure recovers the original identity.
 * Why: generating a new key here would silently end this participant's
 * identity for every peer; a re-signed build that can never decrypt the old
 * file now needs an explicit step (import a backup, or sign out).
 */
function readStoredIdentity(): StoredParticipantIdentity | null {
  if (cachedIdentity) {return cachedIdentity}

  const identityPath = getIdentityPath()
  let raw: Buffer
  try {
    raw = readFileSync(identityPath)
  } catch (error) {
    if (errorText(error) === 'ENOENT') {return null}
    throw unavailable(identityPath, errorText(error))
  }

  const decoded = decodeStoredIdentity(raw)
  if (typeof decoded === 'string') {
    throw unavailable(identityPath, decoded)
  }
  lastLoggedUnavailableDetail = null
  cachedIdentity = decoded
  return cachedIdentity
}

function writeStoredIdentity(identity: StoredParticipantIdentity): void {
  const serialized = JSON.stringify(identity)
  const contents = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(serialized)
    : Buffer.from(serialized, 'utf8')

  if (!safeStorage.isEncryptionAvailable()) {
    console.warn(
      '[communications] safeStorage encryption unavailable — storing participant identity in plaintext'
    )
  }

  // Atomic temp + rename, 0600: an interrupted write leaves the old identity intact.
  writeSecureFile(getIdentityPath(), contents)
  cachedIdentity = identity
}

/**
 * `os.userInfo()` calls into the OS's directory-services lookup
 * (getpwuid on POSIX), which can throw rather than return an empty string
 * when that service is unreachable — sandboxed/containerized environments
 * with no matching passwd entry hit this in practice. A username is
 * cosmetic here, so any failure falls back to the same 'dobius' default the
 * existing `|| 'dobius'` already covered for the empty-string case.
 */
function resolveDefaultUsername(): string {
  try {
    return userInfo().username || 'dobius'
  } catch {
    return 'dobius'
  }
}

function generateIdentity(): StoredParticipantIdentity {
  const privateKeyBytes = schnorr.utils.randomPrivateKey()
  const pubkeyHex = bytesToHex(schnorr.getPublicKey(privateKeyBytes))
  return {
    privateKeyHex: bytesToHex(privateKeyBytes),
    pubkeyHex,
    username: resolveDefaultUsername()
  }
}

function toPublicIdentity(identity: StoredParticipantIdentity): ParticipantPublicIdentity {
  return { pubkey: identity.pubkeyHex, username: identity.username }
}

export function hasParticipantIdentity(): boolean {
  return existsSync(getIdentityPath())
}

/** Reads the existing participant identity, generating and persisting one if none exists. */
export function ensureParticipantIdentity(): ParticipantPublicIdentity {
  const existing = readStoredIdentity()
  if (existing) {return toPublicIdentity(existing)}

  const generated = generateIdentity()
  writeStoredIdentity(generated)
  const publicIdentity = toPublicIdentity(generated)
  notifyIdentityCreated(publicIdentity)
  return publicIdentity
}

function notifyIdentityCreated(identity: ParticipantPublicIdentity): void {
  if (!identityCreatedListener) {return}
  try {
    identityCreatedListener(identity)
  } catch (err) {
    console.warn(
      `[communications] participant identity created listener failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    )
  }
}

/** Public identity only — throws if `ensureParticipantIdentity` has never run. */
export function getParticipantPublicIdentity(): ParticipantPublicIdentity {
  const identity = readStoredIdentity()
  if (!identity) {throw new Error('Communications participant identity is not configured')}
  return toPublicIdentity(identity)
}

/**
 * True when Electron's OS-level key encryption backed this identity's
 * on-disk file. Surfaced to the UI (Identity.storage) so it can tell the
 * user their key is protected by Keychain/DPAPI/libsecret vs. a plaintext
 * fallback — never used to gate any security decision in this module.
 */
export function getParticipantStorageBackend(): 'system-keyring' | 'local-file' {
  return safeStorage.isEncryptionAvailable() ? 'system-keyring' : 'local-file'
}

/**
 * Overwrites the stored identity with a caller-supplied private key (the
 * NIP-49/nsec import path). `privateKeyHex` must already be validated by the
 * caller — this function does not touch the renderer and is only ever
 * reached from a main-process-owned flow (see identity/secure-key-entry-window.ts).
 */
export function importParticipantPrivateKey(
  privateKeyHex: string,
  username?: string
): ParticipantPublicIdentity {
  if (!/^[0-9a-f]{64}$/.test(privateKeyHex)) {
    throw new Error('importParticipantPrivateKey: private key must be 64 lowercase hex characters')
  }
  const pubkeyHex = bytesToHex(schnorr.getPublicKey(hexToBytes(privateKeyHex)))
  // Runs even when `username` is given: it moves an unavailable identity aside.
  const existingUsername = readUsernameForImport()
  const identity: StoredParticipantIdentity = {
    privateKeyHex,
    pubkeyHex,
    username: username ?? existingUsername ?? resolveDefaultUsername()
  }
  writeStoredIdentity(identity)
  return toPublicIdentity(identity)
}

/**
 * An explicit import may replace an unavailable identity, but its file is
 * moved aside first (never overwritten); if that move fails the import fails.
 */
function readUsernameForImport(): string | undefined {
  try {
    return readStoredIdentity()?.username
  } catch (error) {
    if (!(error instanceof ParticipantIdentityUnavailableError)) {throw error}
    const keptPath = `${error.filePath}.unavailable-${Date.now()}`
    renameSync(error.filePath, keptPath)
    console.warn(`[participant-identity-store] unavailable identity kept at ${keptPath} before import`)
    return undefined
  }
}

/**
 * INTERNAL — the only sanctioned way to read the raw private key out of this
 * store. Reserved for main-process crypto modules that need the actual key
 * bytes to do their job (NIP-44 self-encryption, NIP-49 backup encryption,
 * the secure key-entry/export window). The returned value must NEVER be
 * placed on an IPC reply, logged, or otherwise allowed to reach a renderer —
 * every caller of this function is responsible for upholding that on its own.
 */
export function unsafeGetParticipantPrivateKeyForCrypto(): {
  privateKeyHex: string
  pubkeyHex: string
} {
  const identity = readStoredIdentity()
  if (!identity) {throw new Error('Communications participant identity is not configured')}
  return { privateKeyHex: identity.privateKeyHex, pubkeyHex: identity.pubkeyHex }
}

// NIP-01 event id: sha256 of the compact JSON array [0, pubkey, created_at,
// kind, tags, content]. JSON.stringify with no indent argument already
// produces the required whitespace-free serialization.
function computeEventId(
  pubkeyHex: string,
  createdAt: number,
  kind: number,
  tags: string[][],
  content: string
): Uint8Array {
  const serialized = JSON.stringify([0, pubkeyHex, createdAt, kind, tags, content])
  return sha256(new TextEncoder().encode(serialized))
}

/** Signs an event with the participant's private key. The key never leaves this module. */
export function signParticipantEvent(event: UnsignedCommunicationsEvent): SignedCommunicationsEvent {
  const identity = readStoredIdentity()
  if (!identity) {throw new Error('Communications participant identity is not configured')}

  const createdAt = event.createdAt ?? Math.floor(Date.now() / 1000)
  const idBytes = computeEventId(identity.pubkeyHex, createdAt, event.kind, event.tags, event.content)
  const sigBytes = schnorr.sign(idBytes, hexToBytes(identity.privateKeyHex))

  return {
    id: bytesToHex(idBytes),
    pubkey: identity.pubkeyHex,
    created_at: createdAt,
    kind: event.kind,
    tags: event.tags,
    content: event.content,
    sig: bytesToHex(sigBytes)
  }
}

/**
 * Explicit reset (sign-out). The identity file is moved to
 * `<file>.signed-out-<ms>`, never deleted, because it may only be
 * temporarily unreadable; if it cannot be moved, the reset is refused.
 */
export function clearParticipantIdentity(): void {
  const identityPath = getIdentityPath()
  try {
    renameSync(identityPath, `${identityPath}.signed-out-${Date.now()}`)
  } catch (error) {
    if (errorText(error) !== 'ENOENT') {
      throw new Error(
        `Sign-out refused: the Communications identity file could not be kept aside (${errorText(error)}); nothing was deleted`
      )
    }
  }
  cachedIdentity = null
  lastLoggedUnavailableDetail = null
}
