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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'

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

function readStoredIdentity(): StoredParticipantIdentity | null {
  if (cachedIdentity) {return cachedIdentity}

  const identityPath = getIdentityPath()
  if (!existsSync(identityPath)) {return null}

  const raw = readFileSync(identityPath)
  const decrypted = safeStorage.isEncryptionAvailable()
    ? safeStorage.decryptString(raw)
    : raw.toString('utf8')

  const parsed = JSON.parse(decrypted) as Partial<StoredParticipantIdentity>
  if (
    typeof parsed.privateKeyHex !== 'string' ||
    typeof parsed.pubkeyHex !== 'string' ||
    typeof parsed.username !== 'string'
  ) {
    throw new Error('Communications participant identity is invalid')
  }

  cachedIdentity = parsed as StoredParticipantIdentity
  return cachedIdentity
}

function writeStoredIdentity(identity: StoredParticipantIdentity): void {
  const dir = getDobiusDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const serialized = JSON.stringify(identity)
  const contents = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(serialized)
    : Buffer.from(serialized, 'utf8')

  if (!safeStorage.isEncryptionAvailable()) {
    console.warn(
      '[communications] safeStorage encryption unavailable — storing participant identity in plaintext'
    )
  }

  writeFileSync(getIdentityPath(), contents, { mode: 0o600 })
  cachedIdentity = identity
}

function generateIdentity(): StoredParticipantIdentity {
  const privateKeyBytes = schnorr.utils.randomPrivateKey()
  const pubkeyHex = bytesToHex(schnorr.getPublicKey(privateKeyBytes))
  return {
    privateKeyHex: bytesToHex(privateKeyBytes),
    pubkeyHex,
    username: userInfo().username || 'dobius'
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
  return toPublicIdentity(generated)
}

/** Public identity only — throws if `ensureParticipantIdentity` has never run. */
export function getParticipantPublicIdentity(): ParticipantPublicIdentity {
  const identity = readStoredIdentity()
  if (!identity) {throw new Error('Communications participant identity is not configured')}
  return toPublicIdentity(identity)
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

/** Test/reset hook only — clears the in-memory cache and the on-disk file. */
export function clearParticipantIdentity(): void {
  cachedIdentity = null
  rmSync(getIdentityPath(), { force: true })
}
