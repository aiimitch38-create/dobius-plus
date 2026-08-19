import { nip44DecryptFromPeer, nip44EncryptToPeer } from '../identity/nip44'
import { signParticipantEvent } from '../participant-identity-store'

// Why main process, not the renderer: the observer commands were first
// designed to run inside dobiusCommunications.ts (the vendor renderer file)
// against the Nostr identity that used to live in the renderer's
// localStorage. That identity is being retired by the identity slice
// (identity/participant-identity-store.ts, nip44.ts) in favor of a
// main-process-only, safeStorage-encrypted key — renderer crypto built
// against the old localStorage identity would silently stop matching once
// that migration lands. This delegates to the identity slice's ONE NIP-44
// implementation (nip44.ts's own doc comment: "must not be duplicated")
// rather than writing a second one here.
const OBSERVER_FRAME_KIND = 24200

type ParsedObserverEvent = {
  pubkey: string
  content: string
}

function parseObserverEvent(eventJson: string): ParsedObserverEvent {
  let parsed: unknown
  try {
    parsed = JSON.parse(eventJson)
  } catch {
    throw new Error('decrypt_observer_event: eventJson was not valid JSON')
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('decrypt_observer_event: event was not an object')
  }
  const record = parsed as Record<string, unknown>
  if (typeof record.pubkey !== 'string' || typeof record.content !== 'string') {
    throw new Error('decrypt_observer_event: event is missing pubkey/content')
  }
  return { pubkey: record.pubkey, content: record.content }
}

/** Decrypts an observer frame (kind 24200) sent by `event.pubkey`, addressed to us. */
export function decryptObserverEvent(eventJson: string): unknown {
  const event = parseObserverEvent(eventJson)
  const plaintext = nip44DecryptFromPeer(event.pubkey.toLowerCase(), event.content)
  return JSON.parse(plaintext)
}

/** Builds a signed, encrypted observer control frame addressed to `agentPubkey`. Returns event JSON. */
export function buildObserverControlEvent(agentPubkey: string, payload: unknown): string {
  const target = agentPubkey.trim().toLowerCase()
  const content = nip44EncryptToPeer(target, JSON.stringify(payload ?? {}))
  const event = signParticipantEvent({
    kind: OBSERVER_FRAME_KIND,
    content,
    tags: [
      ['p', target],
      ['frame', 'control']
    ]
  })
  return JSON.stringify(event)
}
