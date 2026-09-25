// Why: the E2EE hello/auth pair used to be identical on every connection, so a
// sniffed hello + encrypted auth replayed on a new socket authenticated as the
// phone. Handshake v2 puts a fresh server challenge in `e2ee_ready` that the
// client must echo inside its encrypted `e2ee_auth`; only the holder of the
// client's ephemeral secret can produce that frame. Kept in shared/ so the CLI,
// web client and desktop remote-host client build the same auth frame. The
// Expo app (mobile/) cannot import from here and mirrors it in rpc-client.ts.
export const E2EE_HANDSHAKE_VERSION = 2

// Why: sent (encrypted) to clients whose auth frame carries no challenge, i.e.
// builds that predate handshake v2, so they fail with a reason, not silently.
export const E2EE_CLIENT_UPDATE_REQUIRED = 'client_update_required'

export type E2EEAuthPayload = {
  type: 'e2ee_auth'
  deviceToken: string
  challenge?: string
}

// Why: an older desktop sends `e2ee_ready` without a challenge and ignores
// unknown auth fields, so omitting the field keeps new clients compatible.
export function buildE2EEAuthPayload(deviceToken: string, ready: unknown): E2EEAuthPayload {
  const challenge =
    typeof ready === 'object' && ready !== null
      ? (ready as { challenge?: unknown }).challenge
      : undefined
  return typeof challenge === 'string' && challenge.length > 0
    ? { type: 'e2ee_auth', deviceToken, challenge }
    : { type: 'e2ee_auth', deviceToken }
}

export function buildE2EEAuthPayloadFromFrame(
  deviceToken: string,
  readyFrame: string
): E2EEAuthPayload {
  let ready: unknown = null
  try {
    ready = JSON.parse(readyFrame)
  } catch {
    // Callers validate the ready frame first; a parse miss just means no challenge.
    ready = null
  }
  return buildE2EEAuthPayload(deviceToken, ready)
}
