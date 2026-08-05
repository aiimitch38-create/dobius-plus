// Minimal native port of the relay HTTP calls in
// dobius/vendor/buzz-desktop/src/shared/api/dobiusCommunications.ts
// (queryRelay/submitRelayEvent/signedEvent). Signing goes through
// window.api.communications instead of a raw localStorage private key —
// the private key never reaches this renderer.
const DOBIUS_RELAY_HTTP_URL = 'http://localhost:3300'

export type RelayEventRecord = {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
}

export type RelaySubmissionResponse = {
  accepted?: boolean
  event_id?: string
  message?: string
}

export type UnsignedRelayEvent = {
  kind: number
  content: string
  tags: string[][]
  createdAt?: number
}

let cachedPubkey: string | null = null

export async function getOwnPubkey(): Promise<string> {
  if (cachedPubkey) {return cachedPubkey}
  const identity = await window.api.communications.getIdentity()
  cachedPubkey = identity.pubkey
  return cachedPubkey
}

export async function queryRelay(
  filters: Record<string, unknown>[]
): Promise<RelayEventRecord[]> {
  const pubkey = await getOwnPubkey()
  const response = await fetch(`${DOBIUS_RELAY_HTTP_URL}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Pubkey': pubkey },
    body: JSON.stringify(filters)
  })
  if (!response.ok) {throw new Error(await response.text())}
  return response.json() as Promise<RelayEventRecord[]>
}

async function submitSerializedEvent(
  serialized: string,
  actorPubkey: string
): Promise<RelaySubmissionResponse> {
  const response = await fetch(`${DOBIUS_RELAY_HTTP_URL}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Pubkey': actorPubkey },
    body: serialized
  })
  const text = await response.text()
  if (!response.ok) {throw new Error(text)}
  if (!text) {return {}}
  return JSON.parse(text) as RelaySubmissionResponse
}

/** Signs (via the main process) and publishes an event as the local user. */
export async function publishAsSelf(event: UnsignedRelayEvent): Promise<RelaySubmissionResponse> {
  const signed = await window.api.communications.signEvent(event)
  return submitSerializedEvent(JSON.stringify(signed), signed.pubkey)
}

/** Signs (via the main process) and publishes an event as a Dobius-managed agent. */
export async function publishAsAgent(
  agentId: string,
  event: UnsignedRelayEvent
): Promise<RelaySubmissionResponse> {
  const signed = await window.api.communications.signEventAsAgent(agentId, event)
  return submitSerializedEvent(JSON.stringify(signed), signed.pubkey)
}
