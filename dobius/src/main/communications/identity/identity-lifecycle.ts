// Small identity lifecycle operations that don't fit neatly into signing,
// backup, or archival: sign-out, "persist current identity" (Buzz's
// onboarding-complete step), the legacy-storage migration no-op, and the
// nostr-identity-binding signature used to link this Communications
// identity to some external verification flow.
import { app } from 'electron'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils'
import {
  clearParticipantIdentity,
  ensureParticipantIdentity,
  getParticipantStorageBackend,
  unsafeGetParticipantPrivateKeyForCrypto
} from '../participant-identity-store'
import { schnorr } from '@noble/curves/secp256k1'

// Mirrors vendor/buzz-desktop/src/shared/api/identityTypes.ts's `Identity`
// shape. Redefined locally rather than imported: main-process code should
// not depend on the vendored renderer package, and this shape is small and
// stable enough that duplicating it is cheaper than adding that edge.
export type IdentityStorage = 'system-keyring' | 'local-file' | 'environment' | 'ephemeral'

export type Identity = {
  pubkey: string
  displayName: string
  storage?: IdentityStorage
  lost?: boolean
  locked?: boolean
  resetFailed?: boolean
}

function toIdentity(pubkey: string, displayName: string): Identity {
  return {
    pubkey,
    displayName,
    storage: getParticipantStorageBackend(),
    lost: false,
    locked: false,
    resetFailed: false
  }
}

/** Ensures a participant identity exists and returns it in the client's `Identity` shape. */
export function persistCurrentIdentity(): Identity {
  const identity = ensureParticipantIdentity()
  return toIdentity(identity.pubkey, identity.username)
}

export type SignOutOptions = {
  /** Set false in tests to observe the wipe without tearing down the process. */
  relaunch?: boolean
}

/**
 * Wipes the local participant identity and relaunches the app into a fresh
 * onboarding state — this Communications identity's equivalent of Buzz's
 * `sign_out`. Deliberately does not touch per-agent identities
 * (agent-participant-identity-store.ts): those belong to Dobius agents, not
 * to "my account", and signing out of Communications shouldn't orphan them.
 */
export function signOut(options: SignOutOptions = {}): void {
  clearParticipantIdentity()
  if (options.relaunch ?? true) {
    app.relaunch()
    app.exit(0)
  }
}

export type LegacyWorkspaceStorageSnapshot = {
  workspaces: string | null
  activeWorkspaceId: string | null
  onboardingCompletions: { pubkey: string; value: string }[]
}

/**
 * Dobius+ has no predecessor "Sprout" WebKit install to migrate from — this
 * command exists only so the Buzz onboarding flow's legacy-storage read
 * doesn't throw. Always returns an empty snapshot.
 */
export function getLegacyWorkspaceStorage(): LegacyWorkspaceStorageSnapshot {
  return { workspaces: null, activeWorkspaceId: null, onboardingCompletions: [] }
}

export type NostrIdentityBindingInput = {
  challengeId: string
  nonce: string
  verificationCode: string
  origin: string
  expiresAt: string
}

/**
 * Signs a canonical binding string over the challenge fields with the
 * participant's own key and returns `{pubkey, sig}` as JSON. No upstream
 * spec ships with this repo for the exact wire format a verifier expects —
 * this canonicalization (pipe-joined, field order fixed) is this module's
 * own choice; see the build report's PER_COMMAND note for
 * sign_nostr_identity_binding before wiring a real verification server
 * against it.
 */
export function signNostrIdentityBinding(input: NostrIdentityBindingInput): string {
  const { privateKeyHex, pubkeyHex } = unsafeGetParticipantPrivateKeyForCrypto()
  const canonical = [input.origin, input.challengeId, input.nonce, input.verificationCode, input.expiresAt].join(
    '|'
  )
  const digest = sha256(utf8ToBytes(canonical))
  const sig = bytesToHex(schnorr.sign(digest, Buffer.from(privateKeyHex, 'hex')))
  return JSON.stringify({ pubkey: pubkeyHex, sig, canonical })
}
