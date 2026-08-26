/**
 * Wire-level plumbing shared by the relay world-operation modules: the
 * protocol kinds this world speaks, the canonical relay URLs, the two
 * pubkey accessors, and the sign-and-publish / query primitives every
 * world operation funnels through.
 *
 * Domain logic lives in relay-channel-ops.ts and relay-message-ops.ts,
 * which reach this module for everything transport-shaped. The
 * IDENTITY SPLIT rationale for signerPubkey (main-process participant
 * identity, NOT ctx.selfPubkey) is documented at the top of
 * relay-world-ops.ts.
 */
import {
  ensureParticipantIdentity,
  getParticipantPublicIdentity,
  signParticipantEvent,
  type SignedCommunicationsEvent
} from '../participant-identity-store'
import { queryRelayEvents, type RelayQueriedEvent, type RelayQueryFilter } from '../identity/relay-http-client'
import { RELAY_HOST, RELAY_PORT } from '../relay/relay-types'

// Protocol kinds are fixed by the shipped clients (see vendor kinds.ts and
// canvas-relay-kinds.ts's collision audit); redefining them here rather than
// importing the vendored file is deliberate. DM_OPEN_KIND stays in its
// main-process home (relay-dm.ts), which owns the server-side semantics.

export const RELAY_HTTP_URL = `http://${RELAY_HOST}:${RELAY_PORT}`
export const RELAY_WS_URL = `ws://${RELAY_HOST}:${RELAY_PORT}`

export const PROFILE_KIND = 0 // NIP-01 metadata; replaceable per (pubkey, kind)
export const DELETION_KIND = 5 // NIP-09 delete request
export const REACTION_KIND = 7 // NIP-25 reaction
export const MESSAGE_KIND = 9 // Buzz stream message ("h" tag names the channel)
export const MESSAGE_EDIT_KIND = 40003
export const BUZZ_DELETE_MESSAGE_KIND = 9005
export const CHANNEL_METADATA_KIND = 39000 // addressable, "d" tag = channel id
export const CHANNEL_MEMBERSHIP_KIND = 39002 // addressable, "d" tag = channel id
export const MESSAGE_WINDOW_KINDS = [1, 9, 40002, 45001, 45003]
export const THREAD_REPLY_KINDS = [1, 9, 40002, 45003]

/** Pubkey of the main-process participant identity (creates it on first call). */
export function participantPubkey(): string {
  return ensureParticipantIdentity().pubkey
}

/** Pubkey every event in this world is authored with. */
export function signerPubkey(): string {
  return getParticipantPublicIdentity().pubkey
}

type RelaySubmissionResponse = {
  accepted?: boolean
  event_id?: string
  message?: string
}

/**
 * Same round trip as identity/relay-http-client.submitRelayEvent, but it
 * returns the parsed body: open_dm needs the relay's
 * `response:{"channel_id":...}` message, which the void-returning client
 * discards. Kept local rather than widening the shared client (read-only
 * from this directory).
 */
export async function submitRelayEventWithResponse(event: SignedCommunicationsEvent): Promise<RelaySubmissionResponse> {
  const response = await fetch(`${RELAY_HTTP_URL}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event)
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`relay rejected event: HTTP ${response.status}${text ? ` — ${text}` : ''}`)
  }
  if (!text) {
    return {}
  }
  return JSON.parse(text) as RelaySubmissionResponse
}

export async function publishSignedEvent(event: SignedCommunicationsEvent, rejection: string): Promise<string> {
  const submission = await submitRelayEventWithResponse(event)
  if (submission.accepted === false) {
    throw new Error(submission.message || rejection)
  }
  return event.id
}

export function publish(kind: number, content: string, tags: string[][], rejection: string): Promise<string> {
  return publishSignedEvent(signParticipantEvent({ kind, content, tags }), rejection)
}

export function queryRelay(filters: RelayQueryFilter[]): Promise<RelayQueriedEvent[]> {
  return queryRelayEvents(filters)
}

export function newestFirst(events: RelayQueriedEvent[]): RelayQueriedEvent[] {
  return [...events].sort((left, right) => right.created_at - left.created_at)
}

export function eventTag(event: RelayQueriedEvent, name: string): string | null {
  return event.tags.find((tag) => tag[0] === name)?.[1] ?? null
}

export function requiredCtx(value: string | undefined, label: string): string {
  if (typeof value !== 'string' || !value) {
    throw new Error(`Missing ${label} (upstream capture did not populate the context)`)
  }
  return value
}
