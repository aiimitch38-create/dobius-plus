// Browser-native WebSocket transport. This used to shell out to the Tauri
// `plugin:websocket` commands (a native process holding real sockets, keyed
// by a numeric id returned to the renderer). The relay now runs in-process
// inside Dobius+ (ws://localhost:3300), so a plain WebSocket can reach it
// directly — no native plugin required. The numeric id keying is kept so
// callers (RelayClient, ReadOnlyRelayClient) don't need to change shape.
const sockets = new Map<number, WebSocket>();
let nextSocketId = 1;

/**
 * Open a WebSocket and resolve once it is actually connected (mirrors the
 * old `plugin:websocket|connect` command, which likewise didn't resolve
 * until the native socket was open). `onMessage` receives the same shapes
 * `handleWsMessage`/`getTextPayload` already understand: the raw text
 * string for message frames, `{ type: "Close", data: { code, reason } }` on
 * remote close, and `{ type: "Error" }` on a socket error.
 */
export function openWebSocket(
  url: string,
  onMessage: (message: unknown) => void,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let opened = false;

    socket.onopen = () => {
      opened = true;
      const id = nextSocketId++;
      sockets.set(id, socket);
      resolve(id);
    };

    socket.onmessage = (event) => {
      onMessage(event.data);
    };

    socket.onclose = (event) => {
      if (!opened) {
        reject(
          new Error(event.reason || "WebSocket closed before connecting."),
        );
        return;
      }
      onMessage({
        type: "Close",
        data: { code: event.code, reason: event.reason },
      });
    };

    // The spec fires "error" then "close" for a failed/dropped connection.
    // Before open, the close handler above already rejects the connect
    // promise, so this only needs to forward errors on a live connection.
    socket.onerror = () => {
      if (!opened) return;
      onMessage({ type: "Error" });
    };
  });
}

/** Send a text frame on an open socket. Rejects like the old invoke did if the id is unknown. */
export function sendOnWebSocket(id: number, data: string): Promise<void> {
  const socket = sockets.get(id);
  if (!socket) {
    return Promise.reject(new Error(`WebSocket ${id} not found.`));
  }
  socket.send(data);
  return Promise.resolve();
}

/**
 * Remove the connection from the registry and close its socket. Bounded and
 * idempotent; an unknown id (already gone) is a no-op, matching the old
 * native command's "already tearing down" behavior.
 */
export function closeWebSocket(id: number, reason: string): Promise<void> {
  const socket = sockets.get(id);
  sockets.delete(id);
  if (!socket) {
    return Promise.resolve();
  }

  try {
    socket.close();
  } catch (err) {
    console.debug(`closeWebSocket(${id}, ${reason}) rejected:`, err);
  }
  return Promise.resolve();
}

export function closeAllWebSockets(): Promise<void> {
  const allSockets = [...sockets.values()];
  sockets.clear();
  for (const socket of allSockets) {
    try {
      socket.close();
    } catch (err) {
      console.debug("closeAllWebSockets() failed to close a socket:", err);
    }
  }
  return Promise.resolve();
}
