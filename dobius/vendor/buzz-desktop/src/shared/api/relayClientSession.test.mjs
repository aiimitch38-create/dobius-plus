import assert from "node:assert/strict";
import test from "node:test";
import { WebSocketServer } from "ws";

// These tests exercise the browser-native WebSocket transport that replaced
// the Tauri `plugin:websocket` bridge (see relayWebSocketClose.ts). They
// drive RelayClient's real inbound pipeline — handleWsMessage → handleEvent
// → the batched flush → the subscriber's onEvent callback — over a real
// WebSocket connected to a real `ws` server, bypassing only the AUTH
// handshake (which depends on native Tauri signing commands that don't run
// under Node and aren't part of the transport being replaced here).
//
// RelayClient's fields are declared `private` in TypeScript, but `private`
// is erased at compile time (these are plain object properties, not `#`
// fields), so these plain-JS tests can reach `wsId`, `subscriptions`, and
// `connectionGeneration` directly to set up each scenario.

// relayClientSession.ts (and modules it imports) call window.setTimeout /
// clearTimeout / setInterval / clearInterval. Install a real-timer window
// shim before importing, matching the convention used by
// relayRateLimitGate.test.mjs and relayClosedRecovery.test.mjs.
globalThis.window = {
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (...args) => clearTimeout(...args),
  setInterval: (...args) => setInterval(...args),
  clearInterval: (...args) => clearInterval(...args),
};

const { RelayClient } = await import("./relayClientSession.ts");
const { closeWebSocket, openWebSocket } = await import(
  "./relayWebSocketClose.ts"
);

function once(emitter, event) {
  return new Promise((resolve) => emitter.once(event, resolve));
}

async function startServer() {
  const server = new WebSocketServer({ port: 0 });
  await once(server, "listening");
  const address = server.address();
  return { server, url: `ws://127.0.0.1:${address.port}` };
}

const FAKE_EVENT = {
  id: "e1",
  pubkey: "pk1",
  created_at: 1,
  kind: 1,
  tags: [],
  content: "hello",
  sig: "sig1",
};

test("RelayClient's inbound handler delivers a real round-tripped EVENT frame to the live subscriber", async () => {
  const { server, url } = await startServer();
  const connected = once(server, "connection");

  const client = new RelayClient();
  const received = [];
  const subId = "sub-1";
  client.subscriptions.set(subId, {
    mode: "live",
    filter: { kinds: [1], limit: 0 },
    onEvent: (event) => received.push(event),
  });

  const generation = ++client.connectionGeneration;
  const wsId = await openWebSocket(url, (message) => {
    void client.handleWsMessage(message, generation);
  });
  client.wsId = wsId;

  const serverSocket = await connected;
  serverSocket.send(JSON.stringify(["EVENT", subId, FAKE_EVENT]));

  // handleEvent batches into eventBuffer and flushes on a 16ms timer
  // (EVENT_BATCH_MS) before calling onEvent — give it room to fire.
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(received.length, 1);
  assert.deepEqual(received[0], FAKE_EVENT);

  // client.disconnect() (not a raw closeWebSocket) is the real teardown path:
  // it bumps connectionGeneration before closing the socket, so the Close
  // frame this triggers can't reach resetConnection()/scheduleReconnect() and
  // spin up a real reconnect timer against a subscription that's about to be
  // cleared anyway.
  client.disconnect();
  server.close();
});

test("a message delivered on a superseded connection generation is dropped by the inbound handler", async () => {
  const { server, url } = await startServer();
  const connected = once(server, "connection");

  const client = new RelayClient();
  const received = [];
  const subId = "sub-1";
  client.subscriptions.set(subId, {
    mode: "live",
    filter: { kinds: [1], limit: 0 },
    onEvent: (event) => received.push(event),
  });

  // This mirrors exactly what RelayClient.connect() does: capture the
  // generation in the closure passed to openWebSocket before the socket
  // finishes connecting.
  const staleGeneration = ++client.connectionGeneration;
  const wsId = await openWebSocket(url, (message) => {
    void client.handleWsMessage(message, staleGeneration);
  });

  const serverSocket = await connected;

  // A second connect() attempt supersedes this one — connect() (and
  // resetConnection()) bump connectionGeneration again before this stale
  // socket is torn down.
  client.connectionGeneration++;

  // The stale server-side socket delivers a frame anyway (e.g. one that was
  // already in flight when the client superseded the connection). It must
  // never reach the subscriber because handleWsMessage's generation guard
  // (`if (generation !== this.connectionGeneration) return;`) discards it.
  serverSocket.send(JSON.stringify(["EVENT", subId, FAKE_EVENT]));

  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(
    received.length,
    0,
    "stale-generation message must not reach the subscriber",
  );

  // Close the stale socket directly — it was never assigned to client.wsId
  // (the real supersede branch in connect() closes it the same way, without
  // routing through disconnect()). Then tear the client down too.
  await closeWebSocket(wsId, "stale connection attempt");
  client.disconnect();
  server.close();
});
