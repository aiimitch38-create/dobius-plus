import { errorCode, resolveAdamEndpoint } from '../adam-connection'

export { errorCode }

export type IngestResult =
  | { outcome: 'delivered' }
  | { outcome: 'poison' }
  | { outcome: 'retry'; state: 'offline' | 'unauthorized'; detail: string }

// Why: ADAM rejected the record itself; retrying the same bytes can never succeed.
const POISON_STATUSES = new Set([400, 413, 422])

export async function postEventToAdam(body: string, token: string): Promise<IngestResult> {
  let response: Response
  try {
    // Why the shared registry: the same endpoint Jarvis converse uses, read live (#81).
    response = await fetch(`${resolveAdamEndpoint()}/v1/events/ingest`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body,
      signal: AbortSignal.timeout(5_000)
    })
  } catch (error) {
    return { outcome: 'retry', state: 'offline', detail: errorCode(error) }
  }
  if (response.ok) {
    return { outcome: 'delivered' }
  }
  if (response.status === 401 || response.status === 403) {
    return { outcome: 'retry', state: 'unauthorized', detail: `HTTP ${response.status}` }
  }
  if (POISON_STATUSES.has(response.status)) {
    return { outcome: 'poison' }
  }
  return { outcome: 'retry', state: 'offline', detail: `HTTP ${response.status}` }
}
