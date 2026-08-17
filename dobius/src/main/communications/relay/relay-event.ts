/**
 * Structural validation and NIP-01 signature verification for relay events.
 *
 * Why this is a separate module from the store and the server: everything here
 * is pure (no I/O, no sqlite, no HTTP), so both the HTTP `/events` route and
 * the WebSocket `EVENT` frame can reject a bad event before it ever reaches
 * storage. A malformed local client must not be able to poison the store.
 */

import { schnorr } from '@noble/curves/secp256k1'
import { createHash } from 'node:crypto'
import type { RelayEvent } from './relay-types'

/** Event ids and pubkeys are 32 bytes, signatures 64, always lowercase hex on the wire. */
const HEX_32_BYTES = /^[0-9a-f]{64}$/
const HEX_64_BYTES = /^[0-9a-f]{128}$/

/**
 * How far ahead of us an event's `created_at` may be before we reject it.
 *
 * Why tolerate any skew at all: events can be signed by a peer whose clock
 * differs from ours, and rejecting those would drop legitimate messages. 15
 * minutes is generous for a local relay while still blocking events dated far
 * enough ahead to permanently pin themselves to the top of a feed.
 */
const MAX_FUTURE_SKEW_SECONDS = 900

/** Verification outcome. `reason` is surfaced verbatim to clients, so it stays generic. */
export type RelayEventVerification = { ok: true } | { ok: false; reason: string }

function isLowercaseHex(value: unknown, pattern: RegExp): value is string {
  return typeof value === 'string' && pattern.test(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  // Number.isInteger already excludes NaN and Infinity.
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isTagList(value: unknown): value is string[][] {
  return (
    Array.isArray(value) &&
    value.every((tag) => Array.isArray(tag) && tag.every((entry) => typeof entry === 'string'))
  )
}

/**
 * Structural check only — no cryptography. Returns null rather than throwing so
 * callers can map a bad body straight to a 400 without a try/catch.
 *
 * The returned object is rebuilt from the seven known fields, so any extra
 * properties on the input are dropped instead of flowing into the store.
 */
export function parseRelayEvent(value: unknown): RelayEvent | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }

  const candidate = value as Record<string, unknown>
  if (!isLowercaseHex(candidate.id, HEX_32_BYTES)) {
    return null
  }
  if (!isLowercaseHex(candidate.pubkey, HEX_32_BYTES)) {
    return null
  }
  if (!isLowercaseHex(candidate.sig, HEX_64_BYTES)) {
    return null
  }
  if (!isNonNegativeInteger(candidate.created_at)) {
    return null
  }
  if (!isNonNegativeInteger(candidate.kind)) {
    return null
  }
  if (!isTagList(candidate.tags)) {
    return null
  }
  if (typeof candidate.content !== 'string') {
    return null
  }

  return {
    id: candidate.id,
    pubkey: candidate.pubkey,
    created_at: candidate.created_at,
    kind: candidate.kind,
    tags: candidate.tags,
    content: candidate.content,
    sig: candidate.sig
  }
}

/**
 * The NIP-01 event id: sha256 over the compact JSON array
 * `[0, pubkey, created_at, kind, tags, content]`.
 *
 * `JSON.stringify` with no indent argument already emits the whitespace-free
 * form NIP-01 requires; adding any formatting here changes every id.
 */
export function computeRelayEventId(event: RelayEvent): string {
  const serialized = JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content
  ])
  return createHash('sha256').update(serialized, 'utf8').digest('hex')
}

/**
 * Full acceptance check: the id must match the contents, the clock must be
 * sane, and the schnorr signature must verify against the author's pubkey.
 *
 * `opts.now` (seconds since epoch) exists so callers and tests can pin the
 * clock; it defaults to the wall clock.
 */
export function verifyRelayEvent(
  event: RelayEvent,
  opts?: { now?: number }
): RelayEventVerification {
  if (computeRelayEventId(event) !== event.id) {
    return { ok: false, reason: 'invalid: event id does not match its contents' }
  }

  const now = opts?.now ?? Date.now() / 1000
  if (event.created_at > now + MAX_FUTURE_SKEW_SECONDS) {
    return { ok: false, reason: 'invalid: event created_at is too far in the future' }
  }

  // Nostr signs the raw 32-byte event id itself, not a re-hash of it. noble
  // throws (rather than returning false) on malformed hex, so this is wrapped:
  // an unparseable signature is a rejection, not a 500.
  let signatureValid = false
  try {
    signatureValid = schnorr.verify(event.sig, event.id, event.pubkey)
  } catch {
    signatureValid = false
  }
  if (!signatureValid) {
    return { ok: false, reason: 'invalid: event signature verification failed' }
  }

  return { ok: true }
}
