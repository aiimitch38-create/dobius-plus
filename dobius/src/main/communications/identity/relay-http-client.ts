// Minimal HTTP client for the local Communications relay (see
// ../relay/relay-server.ts, read-only from this package — that directory is
// owned by another agent on this branch). Talks to the same `/query` and
// `/events` routes the vendored Buzz webview's WebSocket client ultimately
// rides on, just over plain HTTP for one-shot main-process lookups.
import { RELAY_HOST, RELAY_PORT } from '../relay/relay-types'
import type { SignedCommunicationsEvent } from '../participant-identity-store'

const RELAY_BASE_URL = `http://${RELAY_HOST}:${RELAY_PORT}`

export type RelayQueryFilter = {
  ids?: string[]
  authors?: string[]
  kinds?: number[]
  since?: number
  until?: number
  limit?: number
  [tagFilter: `#${string}`]: string[] | number[] | number | undefined
}

export type RelayQueriedEvent = {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

/** Queries the local relay's `/query` route with one or more NIP-01 filters. */
export async function queryRelayEvents(filters: RelayQueryFilter[]): Promise<RelayQueriedEvent[]> {
  const response = await fetch(`${RELAY_BASE_URL}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(filters)
  })
  if (!response.ok) {
    throw new Error(`relay query failed: HTTP ${response.status}`)
  }
  return (await response.json()) as RelayQueriedEvent[]
}

/** Submits a pre-signed event to the local relay's `/events` route. */
export async function submitRelayEvent(event: SignedCommunicationsEvent): Promise<void> {
  const response = await fetch(`${RELAY_BASE_URL}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event)
  })
  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(`relay rejected event: HTTP ${response.status}${message ? ` — ${message}` : ''}`)
  }
}
