/**
 * NIP-01 filter parsing and matching for the Dobius relay.
 *
 * Pure by design: this module is shared by the `POST /query` path and the
 * WebSocket fanout path, so it must stay free of sqlite, http, fs, and clocks.
 */

import {
  RELAY_DEFAULT_QUERY_LIMIT,
  RELAY_MAX_QUERY_LIMIT,
  RELAY_TAG_FILTER_KEYS,
  type RelayEvent,
  type RelayFilter,
  type RelayTagFilterKey
} from './relay-types'

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function isIntegerArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((entry) => Number.isInteger(entry))
}

/**
 * Copies only the keys of `RelayFilter` out of a client-supplied object.
 *
 * Unknown keys are dropped rather than rejected: the shipped Buzz client
 * already sends `until`, `search`, and `page`, which this relay does not
 * implement. Rejecting them would fail every search and paging query outright.
 */
function parseRelayFilter(value: unknown): RelayFilter | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const source = value as Record<string, unknown>
  const filter: RelayFilter = {}

  for (const key of ['ids', 'authors'] as const) {
    const raw = source[key]
    if (raw === undefined) {
      continue
    }
    if (!isStringArray(raw)) {
      return null
    }
    filter[key] = raw
  }

  if (source.kinds !== undefined) {
    if (!isIntegerArray(source.kinds)) {
      return null
    }
    filter.kinds = source.kinds
  }

  for (const key of ['since', 'limit'] as const) {
    const raw = source[key]
    if (raw === undefined) {
      continue
    }
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      return null
    }
    filter[key] = raw
  }

  for (const key of RELAY_TAG_FILTER_KEYS) {
    const raw = source[key]
    if (raw === undefined) {
      continue
    }
    if (!isStringArray(raw)) {
      return null
    }
    filter[key] = raw
  }

  return filter
}

/**
 * Validates the body of `POST /query`, a JSON array of NIP-01 filters.
 *
 * Returns null instead of throwing so the caller can answer 400 with its own
 * human-readable text — the clients surface non-2xx bodies verbatim.
 */
export function parseRelayFilters(value: unknown): RelayFilter[] | null {
  if (!Array.isArray(value)) {
    return null
  }
  const filters: RelayFilter[] = []
  for (const entry of value) {
    const filter = parseRelayFilter(entry)
    if (filter === null) {
      return null
    }
    filters.push(filter)
  }
  return filters
}

/**
 * The filter key carries a leading '#' that the stored tag name does not:
 * `'#p': [pubkey]` matches an event tag `['p', pubkey]`.
 */
function eventHasTagValue(event: RelayEvent, key: RelayTagFilterKey, values: string[]): boolean {
  const name = key.slice(1)
  return event.tags.some((tag) => tag[0] === name && tag.length > 1 && values.includes(tag[1]))
}

/**
 * NIP-01 matching: every present condition is ANDed, each condition is a set
 * membership test ORed within itself, and an absent condition is no constraint.
 * An explicitly empty array therefore matches nothing, which falls out of
 * `[].includes(...)` being false — that asymmetry is intentional.
 */
export function eventMatchesFilter(event: RelayEvent, filter: RelayFilter): boolean {
  if (filter.ids !== undefined && !filter.ids.includes(event.id)) {
    return false
  }
  if (filter.authors !== undefined && !filter.authors.includes(event.pubkey)) {
    return false
  }
  if (filter.kinds !== undefined && !filter.kinds.includes(event.kind)) {
    return false
  }
  if (filter.since !== undefined && event.created_at < filter.since) {
    return false
  }
  for (const key of RELAY_TAG_FILTER_KEYS) {
    const values = filter[key]
    if (values !== undefined && !eventHasTagValue(event, key, values)) {
      return false
    }
  }
  return true
}

/** Used by the live WebSocket path to decide whether to push a new event. */
export function eventMatchesAnyFilter(event: RelayEvent, filters: RelayFilter[]): boolean {
  return filters.some((filter) => eventMatchesFilter(event, filter))
}

/**
 * `limit` clamped to [1, RELAY_MAX_QUERY_LIMIT].
 *
 * A missing or nonsensical limit falls back to the default rather than being
 * treated as unbounded: `/query` has no pagination, so an uncapped feed query
 * grows without limit as history accumulates.
 */
export function resolveQueryLimit(filter: RelayFilter): number {
  const { limit } = filter
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1) {
    return RELAY_DEFAULT_QUERY_LIMIT
  }
  return Math.min(limit, RELAY_MAX_QUERY_LIMIT)
}

/** Newest first, with ascending id as a deterministic tiebreaker. */
function compareNewestFirst(left: RelayEvent, right: RelayEvent): number {
  if (left.created_at !== right.created_at) {
    return right.created_at - left.created_at
  }
  if (left.id === right.id) {
    return 0
  }
  return left.id < right.id ? -1 : 1
}

function dedupeById(events: RelayEvent[]): RelayEvent[] {
  const byId = new Map<string, RelayEvent>()
  for (const event of events) {
    if (!byId.has(event.id)) {
      byId.set(event.id, event)
    }
  }
  return [...byId.values()]
}

/**
 * Applies every filter and merges the results.
 *
 * NIP-01 applies `limit` PER FILTER — each filter contributes at most its own
 * limit of the newest matches — and only then are the sets merged and
 * deduplicated. Capping the merged result instead silently drops the older
 * half of a two-filter query.
 */
export function selectMatchingEvents(events: RelayEvent[], filters: RelayFilter[]): RelayEvent[] {
  const distinct = dedupeById(events)
  const selected = new Map<string, RelayEvent>()
  for (const filter of filters) {
    const matches = distinct.filter((event) => eventMatchesFilter(event, filter))
    matches.sort(compareNewestFirst)
    for (const event of matches.slice(0, resolveQueryLimit(filter))) {
      selected.set(event.id, event)
    }
  }
  return [...selected.values()].sort(compareNewestFirst)
}
