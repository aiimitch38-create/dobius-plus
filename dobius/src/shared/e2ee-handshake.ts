// Why: the E2EE hello/auth pair used to be identical on every connection, so a
// sniffed hello + encrypted auth replayed on a new socket authenticated as the
// phone. Handshake v2 puts a fresh server challenge in `e2ee_ready` that the
// client must echo inside its encrypted `e2ee_auth`; only the holder of the
// client's ephemeral secret can produce that frame. Kept in shared/ so the CLI,
// web client and desktop remote-host client build the same auth frame. The
// Expo app (mobile/) cannot import from here and mirrors it in rpc-client.ts.
import { enableE2EESequencing } from './e2ee-sequencing'

export const E2EE_HANDSHAKE_VERSION = 2

// Why: sent (encrypted) to clients whose auth frame carries no challenge, i.e.
// builds that predate handshake v2, so they fail with a reason, not silently.
export const E2EE_CLIENT_UPDATE_REQUIRED = 'client_update_required'

export type E2EEAuthPayload = {
  type: 'e2ee_auth'
  deviceToken: string
  challenge?: string
}

export function isE2EEHandshakeV2Ready(ready: unknown): ready is { challenge: string } {
  if (typeof ready !== 'object' || ready === null) {
    return false
  }
  const { version, challenge } = ready as { version?: unknown; challenge?: unknown }
  return (
    typeof version === 'number' &&
    version >= E2EE_HANDSHAKE_VERSION &&
    typeof challenge === 'string' &&
    challenge.length > 0
  )
}

// Why: called once the plaintext e2ee_ready arrives, before the first
// encrypted frame. A v2 server gets the challenge echoed and per-direction
// frame counters switched on for this connection's key. An older desktop
// sends neither and ignores unknown auth fields, so the client falls back to
// the v1 frame format there instead of failing.
export function beginE2EEAuth(
  sharedKey: Uint8Array,
  deviceToken: string,
  ready: unknown
): E2EEAuthPayload {
  if (!isE2EEHandshakeV2Ready(ready)) {
    return { type: 'e2ee_auth', deviceToken }
  }
  enableE2EESequencing(sharedKey, 'client')
  return { type: 'e2ee_auth', deviceToken, challenge: ready.challenge }
}

export function beginE2EEAuthFromFrame(
  sharedKey: Uint8Array,
  deviceToken: string,
  readyFrame: string
): E2EEAuthPayload {
  let ready: unknown = null
  try {
    ready = JSON.parse(readyFrame)
  } catch {
    // Callers validate the ready frame first; a parse miss just means v1.
    ready = null
  }
  return beginE2EEAuth(sharedKey, deviceToken, ready)
}
