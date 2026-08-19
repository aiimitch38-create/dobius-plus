/**
 * NIP-42 challenge/response authentication for the relay's WebSocket connections.
 *
 * The vendored Buzz client (relayClientSession.ts) treats this handshake as
 * MANDATORY: `connect()` blocks on an unsolicited `["AUTH", challenge]` frame
 * from us, signs a kind-22242 event in response, and times out after 25s if
 * it never sees `["OK", <that event id>, true, ...]`. This module only
 * completes that handshake — it deliberately does not gate REQ/EVENT on
 * authentication, so the relay's other, non-authenticating client
 * (relay-client.ts) keeps working exactly as before.
 */

import { randomBytes } from 'node:crypto'
import type { WebSocket } from 'ws'
import { parseRelayEvent, verifyRelayEvent } from './relay-event'
import type { RelayEvent } from './relay-types'
import { sendFrame } from './relay-wire'

/** NIP-42 client authentication event kind. */
const AUTH_EVENT_KIND = 22242

/**
 * How far in the past an AUTH event's `created_at` may be before it's
 * rejected as stale. verifyRelayEvent already bounds how far it can be in
 * the FUTURE; this bounds the other direction, since an AUTH event is meant
 * to be signed on the spot in response to a challenge we just issued.
 */
const MAX_AUTH_EVENT_AGE_SECONDS = 600

/** Per-connection auth state: the challenge we issued and who has proven it. */
export type ConnectionAuthState = {
  challenge: string
  authenticatedPubkey: string | null
}

/** A fresh, unpredictable challenge — 32 bytes from the OS CSPRNG, hex-encoded. */
function createAuthState(): ConnectionAuthState {
  return { challenge: randomBytes(32).toString('hex'), authenticatedPubkey: null }
}

/** Registers a new connection's auth state and returns the challenge to send it. */
export function beginAuthChallenge(auth: Map<WebSocket, ConnectionAuthState>, socket: WebSocket): string {
  const state = createAuthState()
  auth.set(socket, state)
  return state.challenge
}

function tagValue(event: RelayEvent, name: string): string | undefined {
  return event.tags.find((tag) => tag[0] === name)?.[1]
}

type AuthReply = ['OK', string, true, ''] | ['OK', string, false, string] | ['NOTICE', string]

/**
 * Validates an inbound `["AUTH", <event>]` frame's event against the
 * challenge issued to this connection, records the authenticated pubkey on
 * `state` when it succeeds, and returns the frame to reply with.
 *
 * Reuses `verifyRelayEvent` for id/signature/future-skew so this only adds
 * the NIP-42-specific checks: kind, matching challenge, a relay tag, and a
 * lower bound on `created_at`.
 */
export function applyAuthFrame(
  state: ConnectionAuthState,
  value: unknown,
  opts?: { now?: number }
): AuthReply {
  const event = parseRelayEvent(value)
  if (!event) {
    return ['NOTICE', 'invalid: not a well-formed Nostr event']
  }

  const verification = verifyRelayEvent(event, opts)
  if (!verification.ok) {
    return ['OK', event.id, false, verification.reason]
  }
  if (event.kind !== AUTH_EVENT_KIND) {
    return ['OK', event.id, false, `invalid: AUTH event must be kind ${AUTH_EVENT_KIND}`]
  }
  if (tagValue(event, 'challenge') !== state.challenge) {
    return ['OK', event.id, false, 'invalid: AUTH event challenge does not match']
  }
  if (tagValue(event, 'relay') === undefined) {
    return ['OK', event.id, false, 'invalid: AUTH event is missing a relay tag']
  }
  const now = opts?.now ?? Date.now() / 1000
  if (event.created_at < now - MAX_AUTH_EVENT_AGE_SECONDS) {
    return ['OK', event.id, false, 'invalid: AUTH event is too old']
  }

  state.authenticatedPubkey = event.pubkey
  return ['OK', event.id, true, '']
}

/** Looks up this connection's auth state and replies to an inbound `["AUTH", ...]` frame. */
export function handleAuthVerb(
  auth: Map<WebSocket, ConnectionAuthState>,
  socket: WebSocket,
  value: unknown
): void {
  const state = auth.get(socket)
  if (state) {
    sendFrame(socket, applyAuthFrame(state, value))
  }
}
