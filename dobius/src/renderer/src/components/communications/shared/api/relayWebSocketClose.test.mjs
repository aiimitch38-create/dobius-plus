import assert from "node:assert/strict";
import test from "node:test";
import { WebSocketServer } from "ws";

import {
  closeAllWebSockets,
  closeWebSocket,
  openWebSocket,
  sendOnWebSocket,
} from "./relayWebSocketClose.ts";

function once(emitter, event) {
  return new Promise((resolve) => emitter.once(event, resolve));
}

/** Start a `ws` server on an ephemeral port and return its ws:// URL + handle. */
async function startServer() {
  const server = new WebSocketServer({ port: 0 });
  await once(server, "listening");
  const address = server.address();
  return { server, url: `ws://127.0.0.1:${address.port}` };
}

/**
 * server.close() only stops accepting NEW connections — it does not drop
 * already-open ones, and the underlying http.Server won't emit "close" (or
 * release its port) until every connection ends. A client-side close alone
 * races that teardown, which can leave an open handle keeping the test
 * process alive past the assertions. Force-terminate every live connection
 * and await the real close so each test leaves nothing behind.
 */
function stopServer(server) {
  return new Promise((resolve) => {
    for (const client of server.clients) {
      client.terminate();
    }
    server.close(() => resolve());
  });
}

test("openWebSocket resolves with a numeric id and delivers text frames as raw strings", async () => {
  const { server, url } = await startServer();
  const connected = once(server, "connection");

  const received = [];
  const id = await openWebSocket(url, (message) => received.push(message));
  assert.equal(typeof id, "number");

  const serverSocket = await connected;
  serverSocket.send('["EVENT","sub-1",{"id":"e1"}]');

  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(received, ['["EVENT","sub-1",{"id":"e1"}]']);
  // A plain string is exactly what getTextPayload's first branch expects
  // unchanged, matching the old Tauri `{ type: "Text", data }` payload once
  // unwrapped.
  assert.equal(typeof received[0], "string");

  await closeWebSocket(id, "test cleanup");
  await stopServer(server);
});

test("sendOnWebSocket writes a frame the server receives", async () => {
  const { server, url } = await startServer();
  const connected = once(server, "connection");

  const id = await openWebSocket(url, () => {});
  const serverSocket = await connected;

  const serverReceived = once(serverSocket, "message");
  await sendOnWebSocket(id, '["REQ","sub-1",{}]');
  const data = await serverReceived;

  assert.equal(data.toString(), '["REQ","sub-1",{}]');

  await closeWebSocket(id, "test cleanup");
  await stopServer(server);
});

test("sendOnWebSocket rejects for an unknown id", async () => {
  await assert.rejects(
    () => sendOnWebSocket(999_999, "nope"),
    /WebSocket 999999 not found/,
  );
});

test("openWebSocket delivers a synthesized Close message when the server closes the connection", async () => {
  const { server, url } = await startServer();
  const connected = once(server, "connection");

  const received = [];
  await openWebSocket(url, (message) => received.push(message));
  const serverSocket = await connected;

  serverSocket.close(1000, "bye");
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(received.length, 1);
  assert.equal(received[0].type, "Close");
  assert.equal(typeof received[0].data.code, "number");

  await stopServer(server);
});

test("closeWebSocket removes the socket from the registry (further sends reject)", async () => {
  const { server, url } = await startServer();
  const connected = once(server, "connection");

  const id = await openWebSocket(url, () => {});
  await connected;

  await closeWebSocket(id, "community switch");
  await assert.rejects(() => sendOnWebSocket(id, "too late"));

  await stopServer(server);
});

test("closeWebSocket is idempotent for an id that is already gone", async () => {
  await closeWebSocket(123_456, "connection reset");
});

test("closeAllWebSockets closes every open socket and clears the registry", async () => {
  const { server, url } = await startServer();
  const firstConnected = once(server, "connection");
  const id1 = await openWebSocket(url, () => {});
  await firstConnected;

  const secondConnected = once(server, "connection");
  const id2 = await openWebSocket(url, () => {});
  await secondConnected;

  await closeAllWebSockets();

  await assert.rejects(() => sendOnWebSocket(id1, "x"));
  await assert.rejects(() => sendOnWebSocket(id2, "x"));

  await stopServer(server);
});
