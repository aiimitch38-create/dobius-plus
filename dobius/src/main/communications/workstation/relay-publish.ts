// Minimal, self-contained publisher for the local Communications relay's
// `/events` route. src/main/communications/identity/relay-http-client.ts
// already does this, but that directory belongs to another agent working on
// this branch (see its own file comment: "read-only from this package, that
// directory is owned by another agent"); this file avoids depending on code
// that could be edited out from under this feature mid-build by defining its
// own copy of the same tiny, stable contract — the same pattern that file and
// vendor/buzz-desktop/src/shared/api/dobiusCommunications.ts both already use
// independently for this exact constant.
export type SignedCommunicationsEvent = {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

const RELAY_HTTP_BASE_URL = 'http://127.0.0.1:3300'

/** Submits a pre-signed event to the local relay. Throws on a non-2xx response. */
export async function publishSignedEvent(event: SignedCommunicationsEvent): Promise<void> {
  const response = await fetch(`${RELAY_HTTP_BASE_URL}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event)
  })
  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new Error(`relay rejected event: HTTP ${response.status}${message ? ` — ${message}` : ''}`)
  }
}
