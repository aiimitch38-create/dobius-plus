/**
 * Shared wire types for the Dobius relay (port 3300).
 *
 * Why these shapes are fixed: they are dictated by the already-shipped Buzz
 * clients, not chosen by us. `RelayEvent` mirrors the record returned from
 * `POST /query` (see vendor/buzz-desktop/src/shared/api/dobiusCommunications.ts
 * queryRelay, and src/renderer/src/components/buzz/native/relay-client.ts).
 * Changing a field name here breaks the Buzz Inbox silently.
 */

/** A Nostr event exactly as the Buzz clients expect it back from /query. */
export type RelayEvent = {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

/**
 * The subset of NIP-01 filter keys the Buzz clients actually send.
 *
 * Audited across both call sites: `ids`, `authors`, `kinds`, `since`, `limit`,
 * and the tag filters `#d`, `#p`, `#h`, `#e`. Deliberately NOT a full NIP-01
 * filter — `until`, `search`, and arbitrary `#<letter>` tags are unused, so
 * supporting them would be speculative surface.
 */
export type RelayFilter = {
  ids?: string[]
  authors?: string[]
  kinds?: number[]
  since?: number
  limit?: number
  '#d'?: string[]
  '#p'?: string[]
  '#h'?: string[]
  '#e'?: string[]
}

/** Tag filter keys supported by RelayFilter, in one place so store and matcher agree. */
export const RELAY_TAG_FILTER_KEYS = ['#d', '#p', '#h', '#e'] as const
export type RelayTagFilterKey = (typeof RELAY_TAG_FILTER_KEYS)[number]

/** Response body of `POST /events`. */
export type RelaySubmissionResponse = {
  accepted?: boolean
  event_id?: string
  message?: string
}

export const RELAY_PORT = 3300
export const RELAY_HOST = '127.0.0.1'

/**
 * Default cap when a filter omits `limit`.
 *
 * Why a cap at all: `/query` returns a JSON array with no pagination, so an
 * unbounded feed query would grow without limit as history accumulates.
 */
export const RELAY_DEFAULT_QUERY_LIMIT = 500

/** Hard ceiling on any single query, even when the client asks for more. */
export const RELAY_MAX_QUERY_LIMIT = 5000

/**
 * Kinds whose newest event per (pubkey, kind) replaces older ones.
 * Kind 0 is the profile metadata event (NIP-01).
 */
export function isReplaceableKind(kind: number): boolean {
  return kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000)
}

/**
 * Addressable kinds replace per (pubkey, kind, d-tag) rather than per
 * (pubkey, kind). Buzz uses this range for channel metadata (39000/39002)
 * and 30622, all of which carry a `d` tag.
 */
export function isAddressableKind(kind: number): boolean {
  return kind >= 30000 && kind < 40000
}
