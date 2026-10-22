import { stopAdamChild } from './adam-child-stop'
import { createAdamBridgeRequest } from './adam-bridge-request'
import { TELEGRAM_INFERENCE_TIMEOUT_MS } from './reply-limits'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import type { Duplex } from 'node:stream'
import type { AdamTelegramReplyRequest } from './types'
import type { PendingReply, GatewayState, AdamGatewayOptions } from './adam-gateway-types'
import {
  AdamBridgeFrameReader,
  ADAM_BRIDGE_TEXT_LIMIT,
  type AdamBridgeFrame
} from './adam-bridge-protocol'

/** A held child-process pipe is the peer identity, not a claimed profile or shared bearer. */
export class AdamReplyGateway {
  private child: ChildProcess | null = null
  private channel: Duplex | null = null
  private state: GatewayState = 'unavailable'
  private generation = 0
  private startup: Promise<void> | null = null
  private startupResolve: (() => void) | null = null
  private startupReject: ((error: Error) => void) | null = null
  private startupTimer: ReturnType<typeof setTimeout> | null = null
  private nonce = ''
  private readonly pending = new Map<string, PendingReply>()
  private readonly cancelling = new Map<string, ReturnType<typeof setTimeout>>()
  private closing: Promise<void> = Promise.resolve()
  private stopEpoch = 0

  constructor(private readonly options: AdamGatewayOptions) {}

  status(): GatewayState {
    return this.state
  }

  start(): Promise<void> {
    const epoch = this.stopEpoch
    return this.closing.then(() => {
      if (epoch !== this.stopEpoch) {
        throw new Error('stale-operation')
      }
      return this.startNow()
    })
  }

  private startNow(): Promise<void> {
    if (this.state === 'ready') {
      return Promise.resolve()
    }
    if (this.startup) {
      return this.startup
    }
    const runtime = this.options.runtime()
    if (!runtime) {
      this.setState('unavailable')
      return Promise.reject(new Error('client-unavailable'))
    }
    const generation = ++this.generation
    this.setState('starting')
    this.nonce = randomBytes(32).toString('base64url')
    const startup = new Promise<void>((resolve, reject) => {
      this.startupResolve = resolve
      this.startupReject = reject
    })
    this.startup = startup
    try {
      const env: NodeJS.ProcessEnv = { ...process.env, HERMES_HOME: runtime.profileHome }
      delete env.ELECTRON_RUN_AS_NODE
      delete env.NODE_OPTIONS
      delete env.DOBIUS_TERMINAL_HANDLE
      const child = (this.options.spawn ?? spawn)(
        runtime.python,
        [
          runtime.runner,
          '--hermes-root',
          runtime.hermesRoot,
          '--profile-home',
          runtime.profileHome
        ],
        {
          cwd: runtime.hermesRoot,
          env,
          stdio: ['ignore', 'ignore', 'ignore', 'pipe'],
          windowsHide: true
        }
      )
      this.child = child
      const channel = child.stdio[3] as Duplex | null
      if (!channel || typeof channel.write !== 'function') {
        throw new Error('client-unavailable')
      }
      this.channel = channel
      const current = (): boolean => generation === this.generation && this.child === child
      const reader = new AdamBridgeFrameReader((frame) => {
        if (current()) {
          this.receive(frame)
        }
      })
      channel.on('data', (bytes: Buffer) => {
        if (!current()) {
          return
        }
        try {
          reader.push(bytes)
        } catch {
          this.fail()
        }
      })
      channel.once('error', () => {
        if (current()) {
          this.fail()
        }
      })
      channel.once('end', () => {
        if (current()) {
          this.fail()
        }
      })
      child.once('error', () => {
        if (current()) {
          this.fail()
        }
      })
      child.once('exit', () => {
        if (current()) {
          this.fail()
        }
      })
      this.startupTimer = setTimeout(() => {
        if (current()) {
          this.fail()
        }
      }, this.options.startupTimeoutMs ?? 45_000)
      this.send({ v: 1, type: 'hello', nonce: this.nonce })
    } catch {
      this.fail()
    }
    return startup
  }

  async reply(request: AdamTelegramReplyRequest): Promise<string> {
    if (this.state !== 'ready' || request.signal.aborted || this.pending.size >= 32) {
      throw new Error('client-unavailable')
    }
    const accountId = this.options.accountId()
    if (!accountId || request.agentId !== 'adam' || request.text.length > ADAM_BRIDGE_TEXT_LIMIT) {
      throw new Error('invalid-input')
    }
    const frame = createAdamBridgeRequest(accountId, request)
    const { id } = frame
    if (this.pending.has(id) || this.cancelling.has(id)) {
      throw new Error('stale-operation')
    }
    return new Promise<string>((resolve, reject) => {
      const abort = (): void => this.cancel(id)
      const timeout = setTimeout(
        abort,
        this.options.requestTimeoutMs ?? TELEGRAM_INFERENCE_TIMEOUT_MS
      )
      request.signal.addEventListener('abort', abort, { once: true })
      this.pending.set(id, {
        resolve,
        reject,
        cleanup: () => {
          clearTimeout(timeout)
          request.signal.removeEventListener('abort', abort)
        }
      })
      try {
        this.send(frame)
        if (request.signal.aborted) {
          this.cancel(id)
        }
      } catch {
        this.fail()
      }
    })
  }

  stop(): Promise<void> {
    this.terminate('unavailable')
    return this.closing
  }

  private cancel(id: string): void {
    const pending = this.pending.get(id)
    if (!pending) {
      return
    }
    this.pending.delete(id)
    pending.cleanup()
    pending.reject(new Error('stale-operation'))
    // A missing terminal cancel receipt retires the exact child, fencing all late replies.
    this.cancelling.set(
      id,
      setTimeout(() => this.fail(), 5_000)
    )
    try {
      this.send({ v: 1, type: 'cancel', id })
    } catch {
      this.fail()
    }
  }

  private receive(frame: AdamBridgeFrame): void {
    if (frame.type === 'ready') {
      if (this.state !== 'starting' || frame.nonce !== this.nonce) {
        this.fail()
        return
      }
      if (this.startupTimer) {
        clearTimeout(this.startupTimer)
      }
      this.startupTimer = null
      this.setState('ready')
      const resolve = this.startupResolve
      this.clearStartup()
      resolve?.()
      return
    }
    if (this.state !== 'ready') {
      this.fail()
      return
    }
    if (!frame.id) {
      this.fail()
      return
    }
    const cancellation = this.cancelling.get(frame.id)
    if (cancellation) {
      if (frame.type !== 'error' || frame.code !== 'cancelled') {
        this.fail()
        return
      }
      clearTimeout(cancellation)
      this.cancelling.delete(frame.id)
      return
    }
    const pending = this.pending.get(frame.id)
    if (!pending) {
      this.fail()
      return
    }
    this.pending.delete(frame.id)
    pending.cleanup()
    if (frame.type === 'reply') {
      pending.resolve(frame.text)
    } else {
      pending.reject(new Error('delivery-failed'))
    }
  }

  private send(frame: Record<string, unknown>): void {
    if (!this.channel || this.channel.destroyed) {
      throw new Error('client-unavailable')
    }
    this.channel.write(`${JSON.stringify(frame)}\n`)
  }

  private fail(): void {
    this.terminate('error')
  }

  private terminate(state: GatewayState): void {
    this.stopEpoch += 1
    this.generation += 1
    this.setState(state)
    if (this.startupTimer) {
      clearTimeout(this.startupTimer)
    }
    this.startupTimer = null
    const reject = this.startupReject
    this.clearStartup()
    reject?.(new Error('client-unavailable'))
    for (const pending of this.pending.values()) {
      pending.cleanup()
      pending.reject(new Error('client-unavailable'))
    }
    this.pending.clear()
    for (const timer of this.cancelling.values()) {
      clearTimeout(timer)
    }
    this.cancelling.clear()
    const child = this.child
    this.child = null
    this.channel?.destroy()
    this.channel = null
    if (child) {
      this.closing = stopAdamChild(child)
    }
  }

  private clearStartup(): void {
    this.startup = null
    this.startupResolve = null
    this.startupReject = null
  }

  private setState(state: GatewayState): void {
    this.state = state
    this.options.onStateChanged?.(state)
  }
}
