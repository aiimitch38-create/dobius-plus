/**
 * Minimal helper for writing a NIP-01 frame to a WebSocket.
 *
 * Split out of relay-server.ts so a sibling module (relay-auth.ts) can send
 * a reply frame directly, without importing the whole HTTP+WS front door.
 */

import { WebSocket } from 'ws'

/** Writes a frame, silently dropping it if the socket is closed or the write races a close. */
export function sendFrame(socket: WebSocket, frame: unknown[]): void {
  if (socket.readyState !== WebSocket.OPEN) {
    return
  }
  try {
    socket.send(JSON.stringify(frame))
  } catch {
    // A socket torn down between the readyState check and the write is a normal
    // disconnect race, not an error worth surfacing; 'close' cleans up after it.
  }
}
