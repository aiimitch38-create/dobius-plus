/* eslint-disable max-lines -- Why: the WebSocket transport owns connection
   admission, heartbeat, pre-auth timeout, and client-id cleanup together; those
   invariants are easier to audit in one transport boundary. */
// Why: the WebSocket transport enables mobile clients to connect to the Dobius
// runtime over the local network. It is plain ws:// on purpose: confidentiality
// and server authentication come from the E2EE channel (e2ee-channel.ts), whose
// server key the phone pins from the pairing QR. React Native cannot pin a
// self-signed TLS cert, so there is no wss:// mode.
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import type { RpcTransport } from './transport'
import { createStaticWebClientHandler } from './static-web-client-handler'

const MAX_WS_MESSAGE_BYTES = 1024 * 1024
// Why: desktop remote-host clients can legitimately hold many concurrent
// streams (session tabs, terminals, file watches, browser streams). Keep the
// cap high enough that leaked/stale streams do not starve short control RPCs.
const MAX_WS_CONNECTIONS = 128
const PRE_AUTH_TIMEOUT_MS = 10_000
// Why: one LAN host cannot hold more than this many sockets that have not
// logged in; the phone connects from its own address and is never affected.
const MAX_PRE_AUTH_PER_ADDRESS = 16
type WebSocketMessagePayload = string | Uint8Array<ArrayBufferLike>
type WebSocketMessageHandler = {
  bivarianceHack(
    msg: WebSocketMessagePayload,
    reply: (response: string) => void,
    ws: WebSocket
  ): void
}['bivarianceHack']

// Why: mobile clients (iOS/Android) regularly background-suspend their
// sockets without the OS sending a TCP FIN/RST, leaving the server with
// half-open WebSockets that count toward MAX_WS_CONNECTIONS. Without this
// heartbeat the only thing that ever reaps them is the OS's TCP keepalive
// (default macOS: ~2 hours idle + 11 min of probes), which is the
// "connection randomly turns green again after a long delay" symptom.
// Pinging every 15s and terminating any client that hasn't pong'd by the
// next tick collapses that worst case to ~30s. RN/browser WebSocket
// runtimes auto-respond to server pings with pongs at the protocol layer,
// so this works for any client that speaks RFC 6455.
const HEARTBEAT_INTERVAL_MS = 15_000

export type WebSocketTransportOptions = {
  host: string
  port: number
  // Why: test-only override. Production uses HEARTBEAT_INTERVAL_MS.
  heartbeatIntervalMs?: number
  // Why: test-only override. Production uses PRE_AUTH_TIMEOUT_MS.
  preAuthTimeoutMs?: number
  // Why: test-only override. Production uses MAX_PRE_AUTH_PER_ADDRESS.
  maxPreAuthPerAddress?: number
  // Why: the pairing server can also serve the browser client, so users do
  // not need a second dev/static server once the web bundle is built.
  staticRoot?: string
}

export class WebSocketTransport implements RpcTransport {
  private readonly host: string
  private readonly port: number
  private readonly heartbeatIntervalMs: number
  private readonly preAuthTimeoutMs: number
  private readonly maxPreAuthPerAddress: number
  private readonly staticRoot: string | undefined
  private httpServer: HttpServer | null = null
  private wss: WebSocketServer | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  // Why: tracks whether each socket has pong'd since the last heartbeat
  // sweep. A socket missing from the set when the next sweep fires is
  // assumed dead and terminated.
  private wsAlive = new WeakSet<WebSocket>()
  private messageHandler: WebSocketMessageHandler | null = null
  private connectionCloseHandler:
    | ((clientId: string | null, ws: WebSocket, hasOtherConnections: boolean) => void)
    | null = null
  // Why: maps each WebSocket to the clientId (deviceToken) that authenticated it,
  // so ws.on('close') can notify the runtime which mobile client disconnected.
  private wsClientIds = new Map<WebSocket, string>()
  private preAuthTimers = new WeakMap<WebSocket, ReturnType<typeof setTimeout>>()
  // Why: sockets that have not authenticated yet, oldest first (Map keeps
  // insertion order). When the slot cap is hit one of these is evicted so
  // unauthenticated LAN clients can never lock a paired phone out; sockets
  // that never sent a frame (not even e2ee_hello) go first.
  private unauthenticatedSockets = new Map<WebSocket, { address: string; spoke: boolean }>()

  constructor({
    host,
    port,
    heartbeatIntervalMs,
    preAuthTimeoutMs,
    maxPreAuthPerAddress,
    staticRoot
  }: WebSocketTransportOptions) {
    this.host = host
    this.port = port
    this.heartbeatIntervalMs = heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS
    this.preAuthTimeoutMs = preAuthTimeoutMs ?? PRE_AUTH_TIMEOUT_MS
    this.maxPreAuthPerAddress = maxPreAuthPerAddress ?? MAX_PRE_AUTH_PER_ADDRESS
    this.staticRoot = staticRoot
  }

  onMessage(handler: WebSocketMessageHandler): void {
    this.messageHandler = handler
  }

  // Why: handlers receive the closing `ws` so per-connection state can be
  // targeted exactly (one paired device may hold multiple concurrent sockets,
  // e.g. host screen + accounts screen). `hasOtherConnections` tells the
  // runtime whether other sockets for the same deviceToken are still alive,
  // so client-scoped teardown (mobile-fit overrides, etc.) only fires on the
  // last disconnect.
  onConnectionClose(
    handler: (clientId: string | null, ws: WebSocket, hasOtherConnections: boolean) => void
  ): void {
    this.connectionCloseHandler = handler
  }

  setClientId(ws: WebSocket, clientId: string): void {
    this.wsClientIds.set(ws, clientId)
    this.unauthenticatedSockets.delete(ws)
    this.clearPreAuthTimer(ws)
  }

  terminateClientConnections(clientId: string): number {
    const sockets = Array.from(this.wsClientIds.entries())
      .filter(([, candidateClientId]) => candidateClientId === clientId)
      .map(([ws]) => ws)
    for (const ws of sockets) {
      // Why: revocation is a security boundary; terminate skips the close
      // handshake so a revoked mobile stream stops immediately.
      ws.terminate()
    }
    return sockets.length
  }

  // Why: when port 0 is passed the OS assigns a random available port. The
  // runtime metadata and mobile QR code need the real port, so callers read
  // it here after start() resolves.
  get resolvedPort(): number {
    const addr = this.httpServer?.address()
    if (addr && typeof addr === 'object') {
      return addr.port
    }
    return this.port
  }

  async start(): Promise<void> {
    if (this.wss) {
      return
    }

    // Why: when the preferred port is occupied (e.g. another Dobius instance is
    // already running), fall back to an OS-assigned port so mobile pairing
    // still works. The QR code reads resolvedPort after start, so it will
    // advertise the correct port regardless.
    let port = this.port
    try {
      await this.tryListen(port)
    } catch (error: unknown) {
      if (isEAddressInUse(error) && port !== 0) {
        console.warn(`[ws-transport] Port ${port} is in use, falling back to OS-assigned port`)
        port = 0
        await this.tryListen(port)
      } else {
        throw error
      }
    }
  }

  private createHttpServer(): HttpServer {
    const requestListener = this.staticRoot
      ? createStaticWebClientHandler(this.staticRoot)
      : undefined
    return createHttpServer(requestListener)
  }

  // Why: the WebSocketServer is attached only after listen succeeds. If we
  // attached it before, the WSS would re-emit the EADDRINUSE error from the
  // httpServer as an uncatchable exception, preventing the fallback from working.
  private async tryListen(port: number): Promise<void> {
    const httpServer = this.createHttpServer()

    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject)
      httpServer.listen(port, this.host, () => {
        httpServer.off('error', reject)
        resolve()
      })
    })

    const wss = new WebSocketServer({
      server: httpServer,
      maxPayload: MAX_WS_MESSAGE_BYTES
    })

    wss.on('connection', (ws, req) => {
      const address = req.socket.remoteAddress ?? 'unknown'
      if (this.countUnauthenticatedFrom(address) >= this.maxPreAuthPerAddress) {
        ws.close(1013, 'Too many pending connections')
        return
      }
      if (wss.clients.size > MAX_WS_CONNECTIONS && !this.evictOldestUnauthenticated()) {
        // Why: every slot holds an authenticated client; those are never
        // displaced by a newcomer that has not proven anything yet.
        ws.close(1013, 'Maximum connections reached')
        return
      }
      this.handleConnection(ws, address)
    })

    this.httpServer = httpServer
    this.wss = wss
    this.startHeartbeat()
  }

  private countUnauthenticatedFrom(address: string): number {
    let count = 0
    for (const entry of this.unauthenticatedSockets.values()) {
      if (entry.address === address) {
        count += 1
      }
    }
    return count
  }

  private evictOldestUnauthenticated(): boolean {
    let victim: WebSocket | null = null
    for (const [ws, entry] of this.unauthenticatedSockets) {
      if (!entry.spoke) {
        victim = ws
        break
      }
      victim ??= ws
    }
    if (!victim) {
      return false
    }
    this.unauthenticatedSockets.delete(victim)
    // Why: terminate frees the slot at once; a close handshake with a silent
    // pre-auth client could hold it until the TCP timeout.
    victim.terminate()
    return true
  }

  // Why: ping every live socket on a fixed cadence and terminate any that
  // didn't pong since the previous tick. This is the only thing that
  // reliably reaps half-open mobile sockets stranded by background
  // suspension without a TCP FIN. See HEARTBEAT_INTERVAL_MS comment.
  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      return
    }
    this.heartbeatTimer = setInterval(() => {
      const wss = this.wss
      if (!wss) {
        return
      }
      for (const ws of wss.clients) {
        if (!this.wsAlive.has(ws)) {
          // Why: terminate() (vs close()) skips the close handshake and
          // immediately fires the 'close' event, freeing the slot. close()
          // on an already-dead socket can hang for the OS-level TCP timeout.
          ws.terminate()
          continue
        }
        this.wsAlive.delete(ws)
        try {
          ws.ping()
        } catch {
          // Why: ping() can throw on a socket that's mid-tear-down; the
          // close handler will run regardless, so swallow the throw.
        }
      }
    }, this.heartbeatIntervalMs)
    if (typeof this.heartbeatTimer.unref === 'function') {
      this.heartbeatTimer.unref()
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  async stop(): Promise<void> {
    const wss = this.wss
    const httpServer = this.httpServer
    this.wss = null
    this.httpServer = null
    this.stopHeartbeat()

    if (wss) {
      for (const client of wss.clients) {
        // Why: stop() is a teardown path. A half-open mobile socket may never
        // answer a graceful close frame, which keeps httpServer.close pending.
        client.terminate()
      }
      wss.close()
    }

    if (httpServer) {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    }
  }

  // Why: WebSocket connections are long-lived (unlike Unix socket which is
  // one-per-request). Multiple requests can be multiplexed on the same
  // connection via the RPC `id` field. The transport delegates all auth
  // and dispatch logic to the message handler set by DobiusRuntimeRpcServer.
  private handleConnection(ws: WebSocket, address: string): void {
    let finalized = false
    const onPong = (): void => {
      this.wsAlive.add(ws)
    }
    const onMessage = (data: WebSocket.RawData, isBinary: boolean): void => {
      // Why: any inbound traffic counts as proof of life, not just pongs.
      // RN's WebSocket runtime auto-pongs server pings transparently, but
      // app-level frames also count toward liveness so an actively-talking
      // client doesn't get terminated mid-request.
      this.wsAlive.add(ws)
      const pendingEntry = this.unauthenticatedSockets.get(ws)
      if (pendingEntry) {
        pendingEntry.spoke = true
      }
      const msg =
        typeof data === 'string'
          ? data
          : isBinary
            ? new Uint8Array(data as Buffer)
            : data.toString()
      this.messageHandler?.(
        msg,
        (response) => {
          // Why: mobile clients disconnect frequently (backgrounding, network
          // switch, phone locked). Guard writes to avoid errors on dead sockets.
          if (ws.readyState === ws.OPEN) {
            ws.send(response)
          }
        },
        ws
      )
    }
    const onError = (): void => {
      // Why: close is not guaranteed after every ws error path; finalize here
      // too so pre-auth E2EE channels and connection ids cannot leak.
      finalizeConnection()
      ws.close()
    }
    const finalizeConnection = (): void => {
      if (finalized) {
        return
      }
      finalized = true
      ws.off('pong', onPong)
      ws.off('message', onMessage)
      ws.off('close', finalizeConnection)
      ws.off('error', onError)
      this.clearPreAuthTimer(ws)
      this.unauthenticatedSockets.delete(ws)
      const clientId = this.wsClientIds.get(ws) ?? null
      this.wsClientIds.delete(ws)
      const hasOtherConnections =
        clientId !== null && Array.from(this.wsClientIds.values()).includes(clientId)
      this.connectionCloseHandler?.(clientId, ws, hasOtherConnections)
    }

    const preAuthTimer = setTimeout(() => {
      if (!this.wsClientIds.has(ws)) {
        // Why: a silent client that only auto-pongs can otherwise occupy one
        // of the finite mobile WebSocket slots forever without ever starting
        // the E2EE handshake.
        ws.terminate()
      }
    }, this.preAuthTimeoutMs)
    if (typeof preAuthTimer.unref === 'function') {
      preAuthTimer.unref()
    }
    this.preAuthTimers.set(ws, preAuthTimer)
    this.unauthenticatedSockets.set(ws, { address, spoke: false })

    // Why: seed alive=true so the first heartbeat tick after connect doesn't
    // treat a fresh socket as dead. Subsequent pongs (or any inbound traffic)
    // re-arm it.
    this.wsAlive.add(ws)

    ws.on('pong', onPong)
    ws.on('message', onMessage)

    // Why: mobile clients disconnect when the phone locks, loses wifi, or
    // backgrounds the app. The runtime must clean up connection-scoped state
    // (e.g., mobile-fit overrides) to prevent orphaned phone-fit on desktop.
    ws.on('close', finalizeConnection)
    ws.on('error', onError)
  }

  private clearPreAuthTimer(ws: WebSocket): void {
    const timer = this.preAuthTimers.get(ws)
    if (timer) {
      clearTimeout(timer)
      this.preAuthTimers.delete(ws)
    }
  }
}

function isEAddressInUse(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EADDRINUSE'
}
