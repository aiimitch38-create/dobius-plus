/**
 * Read-only relay startup status, served to the Communications renderer so its
 * connection card can say WHY the local relay is unreachable instead of a bare
 * "can't reach the relay".
 *
 * Why a dedicated IPC channel instead of a communications-bridge RPC method:
 * the bridge allowlist gates commands the vendored client may run against the
 * runtime; this is an app-health read owned by main, so it rides its own
 * narrow channel next to the bridge (see preload/communications.ts).
 */
export const COMMUNICATIONS_RELAY_STATUS_CHANNEL = 'dobius:communications:relay-status' as const

export type CommunicationsRelayState = 'starting' | 'running' | 'failed' | 'stopped'

export type CommunicationsRelayStatus = {
  state: CommunicationsRelayState
  /** Plain-language one-liner for the user; present when state is 'failed'. */
  reason?: string
  /** Port the relay bound, or attempted to bind. */
  port?: number
}
