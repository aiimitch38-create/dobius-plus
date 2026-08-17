/**
 * HTTP + WebSocket front door for the local Dobius relay (default 127.0.0.1:3300).
 *
 * One `node:http` server serves both halves — the Buzz clients hardcode the same
 * origin for `POST /query` / `POST /events` and for `ws://localhost:3300`, so a
 * second port would silently break one of them. Everything domain-shaped lives in
 * the sibling modules; this file only does transport, routing, and fanout.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import { parseRelayEvent, verifyRelayEvent } from './relay-event'
import { eventMatchesAnyFilter, parseRelayFilters, selectMatchingEvents } from './relay-filters'
import type { RelayStore } from './relay-store'
import { RELAY_HOST, RELAY_PORT, type RelayEvent, type RelayFilter } from './relay-types'

/** Cap on a single HTTP body or WS frame, so a local client cannot spend all our memory. */
const MAX_BODY_BYTES = 1024 * 1024

/**
 * Why CORS is on EVERY response, error responses included: in a packaged build the
 * Buzz page is loaded from a `file:` URL, so the browser sends `Origin: null` and —
 * because the client adds an `X-Pubkey` header next to `Content-Type` — preflights
 * every POST. A response missing these headers is reported to the page as "Failed
 * to fetch", i.e. indistinguishable from the relay being down.
 */
const PREFLIGHT_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Pubkey',
  'Access-Control-Max-Age': '86400'
} as const

const KNOWN_PATHS = new Set(['/query', '/events'])

export type RelayServerOptions = {
  store: RelayStore
  port?: number
  host?: string
}

export type RelayServerHandle = {
  /** The port actually bound, or the requested one when the bind was refused. */
  port: number
  close: () => Promise<void>
}

/** Live REQ subscriptions, grouped by socket so a disconnect drops all of them at once. */
type RelaySubscriptions = Map<WebSocket, Map<string, RelayFilter[]>>

type RelayContext = {
  store: RelayStore
  subscriptions: RelaySubscriptions
}

type RequestBody = { ok: true; text: string } | { ok: false; reason: 'too-large' | 'aborted' }

function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  })
  res.end(text)
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*'
  })
  res.end(payload)
}

/** Buffers the body, refusing anything over the cap instead of growing without bound. */
function readRequestBody(req: IncomingMessage): Promise<RequestBody> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let bytes = 0
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > MAX_BODY_BYTES) {
        resolve({ ok: false, reason: 'too-large' })
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve({ ok: true, text: Buffer.concat(chunks).toString('utf8') }))
    req.on('error', () => resolve({ ok: false, reason: 'aborted' }))
  })
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch {
    return { ok: false }
  }
}

/**
 * A newly stored event is pushed to every matching live subscription.
 *
 * `origin` is the socket that published it: NIP-01 publishers already know their
 * own event succeeded from the `OK` frame, so echoing it back would double it in
 * their feed. HTTP submissions pass no origin and reach every subscriber.
 */
function broadcast(ctx: RelayContext, event: RelayEvent, origin?: WebSocket): void {
  for (const [socket, subs] of ctx.subscriptions) {
    if (socket === origin) {
      continue
    }
    for (const [subId, filters] of subs) {
      if (eventMatchesAnyFilter(event, filters)) {
        sendFrame(socket, ['EVENT', subId, event])
      }
    }
  }
}

/**
 * Validates, verifies and stores one submitted event.
 *
 * Shared by `POST /events` and the WS `EVENT` frame so the two can never drift
 * into accepting different things. Fanout happens only for an event this call
 * actually wrote: `RelayStore` reports duplicates and superseded revisions as
 * accepted-with-a-message, and neither is new content for a subscriber.
 */
function submitEvent(
  ctx: RelayContext,
  value: unknown,
  origin?: WebSocket
): { status: number; event?: RelayEvent; accepted: boolean; message?: string } {
  const event = parseRelayEvent(value)
  if (!event) {
    return { status: 400, accepted: false, message: 'invalid: not a well-formed Nostr event' }
  }

  const verification = verifyRelayEvent(event)
  if (!verification.ok) {
    return { status: 400, event, accepted: false, message: verification.reason }
  }

  const result = ctx.store.insert(event)
  if (result.accepted && result.message === undefined) {
    broadcast(ctx, event, origin)
  }
  return { status: 200, event, accepted: result.accepted, message: result.message }
}

function handleQuery(ctx: RelayContext, body: string, res: ServerResponse): void {
  const parsed = parseJson(body)
  if (!parsed.ok) {
    sendText(res, 400, 'invalid request: body must be JSON')
    return
  }
  const filters = parseRelayFilters(parsed.value)
  if (!filters) {
    sendText(res, 400, 'invalid request: body must be a JSON array of NIP-01 filters')
    return
  }
  sendJson(res, 200, ctx.store.query(filters))
}

function handleEvents(ctx: RelayContext, body: string, res: ServerResponse): void {
  const parsed = parseJson(body)
  if (!parsed.ok) {
    sendText(res, 400, 'invalid request: body must be JSON')
    return
  }

  const outcome = submitEvent(ctx, parsed.value)
  if (outcome.status !== 200) {
    // The client rethrows a non-2xx body verbatim as the Error message, so this
    // stays a bare human-readable sentence with no JSON wrapper around it.
    sendText(res, 400, outcome.message ?? 'invalid: event rejected')
    return
  }
  sendJson(res, 200, {
    accepted: outcome.accepted,
    event_id: outcome.event?.id,
    ...(outcome.message === undefined ? {} : { message: outcome.message })
  })
}

async function routeRequest(
  ctx: RelayContext,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, PREFLIGHT_HEADERS)
    res.end()
    return
  }

  const path = (req.url ?? '/').split('?')[0]
  if (!KNOWN_PATHS.has(path)) {
    sendText(res, 404, `not found: ${path}`)
    return
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS')
    sendText(res, 405, 'method not allowed: use POST')
    return
  }

  const body = await readRequestBody(req)
  if (!body.ok) {
    if (body.reason === 'too-large') {
      // Answer first, then drop the connection, so the client sees the 413
      // rather than a bare reset it would report as a network failure.
      res.writeHead(413, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      })
      res.end('request body too large', () => req.destroy())
    }
    return
  }

  if (path === '/query') {
    handleQuery(ctx, body.text, res)
    return
  }
  handleEvents(ctx, body.text, res)
}

function sendFrame(socket: WebSocket, frame: unknown[]): void {
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

function handleReq(ctx: RelayContext, socket: WebSocket, frame: unknown[]): void {
  const subId = frame[1]
  if (typeof subId !== 'string') {
    sendFrame(socket, ['NOTICE', 'invalid: REQ needs a string subscription id'])
    return
  }
  const filters = parseRelayFilters(frame.slice(2))
  if (!filters) {
    sendFrame(socket, ['NOTICE', `invalid: REQ ${subId} carries a malformed filter`])
    return
  }

  for (const event of selectMatchingEvents(ctx.store.query(filters), filters)) {
    sendFrame(socket, ['EVENT', subId, event])
  }
  sendFrame(socket, ['EOSE', subId])
  ctx.subscriptions.get(socket)?.set(subId, filters)
}

function handleWsEvent(ctx: RelayContext, socket: WebSocket, frame: unknown[]): void {
  const outcome = submitEvent(ctx, frame[1], socket)
  if (!outcome.event) {
    // No parsed event means no id to key an OK frame on, so NIP-01 leaves NOTICE
    // as the only honest reply.
    sendFrame(socket, ['NOTICE', outcome.message ?? 'invalid: event rejected'])
    return
  }
  sendFrame(socket, ['OK', outcome.event.id, outcome.accepted, outcome.message ?? ''])
}

function handleFrame(ctx: RelayContext, socket: WebSocket, raw: string): void {
  const parsed = parseJson(raw)
  if (!parsed.ok || !Array.isArray(parsed.value) || typeof parsed.value[0] !== 'string') {
    sendFrame(socket, ['NOTICE', 'invalid: frame must be a JSON array starting with a verb'])
    return
  }

  const frame: unknown[] = parsed.value
  const verb = frame[0]
  if (verb === 'REQ') {
    handleReq(ctx, socket, frame)
    return
  }
  if (verb === 'CLOSE') {
    const subId = frame[1]
    if (typeof subId === 'string') {
      ctx.subscriptions.get(socket)?.delete(subId)
    }
    return
  }
  if (verb === 'EVENT') {
    handleWsEvent(ctx, socket, frame)
    return
  }
  sendFrame(socket, ['NOTICE', `invalid: unsupported verb ${verb}`])
}

function attachConnection(ctx: RelayContext, socket: WebSocket): void {
  ctx.subscriptions.set(socket, new Map())

  socket.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
    // One malformed frame must never take down the connection or the process.
    try {
      handleFrame(ctx, socket, Buffer.isBuffer(data) ? data.toString('utf8') : String(data))
    } catch (err) {
      sendFrame(socket, ['NOTICE', `error: ${(err as Error).message}`])
    }
  })
  const drop = (): void => {
    ctx.subscriptions.delete(socket)
  }
  socket.on('close', drop)
  socket.on('error', drop)
}

/**
 * Binds the relay and resolves once it is listening.
 *
 * A failed bind (usually a second Dobius instance already holding the port) is
 * logged and swallowed: the relay is a feature, not a precondition of the app, so
 * it must never reject and block Electron startup. The returned handle is inert
 * in that case and `close()` on it is still safe.
 */
export async function startRelayServer(options: RelayServerOptions): Promise<RelayServerHandle> {
  const host = options.host ?? RELAY_HOST
  const requestedPort = options.port ?? RELAY_PORT
  const ctx: RelayContext = { store: options.store, subscriptions: new Map() }

  const server = createServer((req, res) => {
    routeRequest(ctx, req, res).catch((err: Error) => {
      try {
        sendText(res, 500, `relay error: ${err.message}`)
      } catch {
        // Response already sent or socket gone — nothing left to report on.
      }
    })
  })

  const listening = await listen(server, requestedPort, host)
  if (!listening) {
    return { port: requestedPort, close: async () => {} }
  }

  // Attached only after a successful listen: a WebSocketServer bound to a server
  // that is still failing to listen re-emits the bind error uncatchably.
  const wss = new WebSocketServer({ server, maxPayload: MAX_BODY_BYTES })
  wss.on('connection', (socket) => attachConnection(ctx, socket))
  wss.on('error', (err) => console.warn(`[relay] websocket error: ${err.message}`))
  server.on('error', (err) => console.warn(`[relay] server error: ${err.message}`))

  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : requestedPort
  console.log(`[relay] listening on http://${host}:${port}`)

  return { port, close: () => closeServer(server, wss, ctx) }
}

function listen(server: Server, port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const onError = (err: NodeJS.ErrnoException): void => {
      const detail = err.code === 'EADDRINUSE' ? `port ${port} is already in use` : err.message
      console.warn(`[relay] not started: ${detail}`)
      resolve(false)
    }
    server.once('error', onError)
    server.listen(port, host, () => {
      server.off('error', onError)
      resolve(true)
    })
  })
}

async function closeServer(server: Server, wss: WebSocketServer, ctx: RelayContext): Promise<void> {
  for (const socket of wss.clients) {
    // terminate() over close(): a half-open client would otherwise hold the
    // shutdown open until the OS TCP timeout.
    socket.terminate()
  }
  ctx.subscriptions.clear()
  await new Promise<void>((resolve) => wss.close(() => resolve()))
  // Idle keep-alive sockets (every `fetch` leaves one) keep `close` pending
  // forever otherwise, so the process would never exit.
  server.closeIdleConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
}
