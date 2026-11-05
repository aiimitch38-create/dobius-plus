import { spawn, type ChildProcess } from 'node:child_process'
import { TextDecoder } from 'node:util'
import { adamHermesEnvironment, type AdamHermesRuntime } from './adam-hermes-runtime'

// The CLI normally discovers provider plugins before launching the desktop gateway.
// Reserve stdout for RPC first, then load Adam's configured plugins through Hermes itself.
export const HERMES_DESKTOP_BOOTSTRAP = `from tui_gateway import server
from hermes_cli.plugins import discover_plugins
discover_plugins()
from tui_gateway.entry import main
main()
`

export type HermesDesktopEvent = {
  type: string
  session_id?: string
  payload?: Record<string, unknown>
  respond?: (result: Record<string, unknown>) => void
}
export type HermesRpc = {
  ready: Promise<void>
  request: (
    method: string,
    params: Record<string, unknown>,
    timeoutMs?: number
  ) => Promise<Record<string, unknown>>
  close: () => Promise<void>
}
export class HermesRpcError extends Error {
  constructor(readonly code: number) {
    super('Adam Hermes gateway request failed')
  }
}

type Pending = {
  resolve: (value: Record<string, unknown>) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}
export type HermesRpcOptions = {
  onEvent: (event: HermesDesktopEvent) => void
  onDisconnect: () => void
  spawn?: typeof spawn
  startupTimeoutMs?: number
}

/** Hermes' supported desktop protocol; no PTY, HTTP listener, audio, or credential export. */
export class HermesDesktopRpc implements HermesRpc {
  readonly ready: Promise<void>
  private child: ChildProcess | null = null
  private buffer = Buffer.alloc(0)
  private pending = new Map<number, Pending>()
  private sequence = 0
  private dead = false
  private resolveReady!: () => void
  private rejectReady!: (error: Error) => void
  private startupTimer: ReturnType<typeof setTimeout>
  private closing: Promise<void> | null = null

  constructor(
    runtime: AdamHermesRuntime,
    private readonly options: HermesRpcOptions
  ) {
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    void this.ready.catch(() => undefined)
    this.startupTimer = setTimeout(() => this.fail(), options.startupTimeoutMs ?? 30_000)
    try {
      this.child = (options.spawn ?? spawn)(
        runtime.python,
        runtime.args ?? ['-u', '-c', HERMES_DESKTOP_BOOTSTRAP],
        {
          cwd: runtime.root,
          env: adamHermesEnvironment(runtime),
          stdio: ['pipe', 'pipe', 'ignore'],
          windowsHide: true
        }
      )
      this.child.once('error', () => this.fail())
      this.child.once('exit', () => this.fail())
      this.child.stdin?.on('error', () => this.fail())
      this.child.stdout?.on('data', (chunk: Buffer) => {
        try {
          this.receive(chunk)
        } catch {
          this.fail()
        }
      })
      if (!this.child.stdin || !this.child.stdout) {
        this.fail()
      }
    } catch {
      this.fail()
    }
  }

  request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs = 30_000
  ): Promise<Record<string, unknown>> {
    if (this.dead || !this.child?.stdin) {
      return Promise.reject(new Error('Adam Hermes disconnected'))
    }
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('Adam Hermes gateway timed out'))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.child!.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      } catch {
        this.fail()
      }
    })
  }

  close(): Promise<void> {
    if (this.closing) {
      return this.closing
    }
    this.fail()
    const child = this.child
    this.closing = new Promise((resolve) => {
      if (!child || !child.pid || child.exitCode !== null || child.signalCode !== null) {
        resolve()
        return
      }
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, 2_000)
      timer.unref()
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      child.stdin?.end()
      child.kill('SIGTERM')
    })
    return this.closing
  }

  private fail(): void {
    if (this.dead) {
      return
    }
    this.dead = true
    clearTimeout(this.startupTimer)
    this.rejectReady(new Error('Adam Hermes gateway is unavailable'))
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error('Adam Hermes disconnected'))
    }
    this.pending.clear()
    this.options.onDisconnect()
    // A startup/protocol failure must not strand an unowned provider process.
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill('SIGTERM')
    }
  }

  private receive(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    // Rendered tool output can be large; bound it without ever logging model/protocol contents.
    if (this.buffer.length > 16 * 1024 * 1024) {
      throw new Error('Oversized Hermes frame')
    }
    for (let end = this.buffer.indexOf(10); end >= 0; end = this.buffer.indexOf(10)) {
      const line = this.buffer.subarray(0, end)
      this.buffer = this.buffer.subarray(end + 1)
      if (!line.length) {
        continue
      }
      const frame = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line))
      if (frame?.jsonrpc !== '2.0') {
        throw new Error('Invalid Hermes frame')
      }
      if (frame.method === 'event' && typeof frame.params?.type === 'string') {
        if (frame.params.type === 'gateway.ready') {
          clearTimeout(this.startupTimer)
          this.resolveReady()
        } else {
          this.options.onEvent(frame.params)
        }
      } else if (typeof frame.id === 'string' && typeof frame.method === 'string') {
        const respond = (result: Record<string, unknown>): void => {
          if (!this.dead) {
            this.child?.stdin?.write(
              `${JSON.stringify({ jsonrpc: '2.0', id: frame.id, result })}\n`
            )
          }
        }
        if (['approval', 'clarify', 'sudo', 'secret'].includes(frame.method)) {
          this.options.onEvent({
            type: `${frame.method}.request`,
            session_id: frame.params?.session_id,
            payload: frame.params,
            respond
          })
        } else {
          this.child?.stdin?.write(
            `${JSON.stringify({
              jsonrpc: '2.0',
              id: frame.id,
              error: { code: -32601, message: 'This interaction is unavailable in voice mode' }
            })}\n`
          )
        }
      } else if (typeof frame.id === 'number') {
        const request = this.pending.get(frame.id)
        if (!request) {
          continue
        }
        this.pending.delete(frame.id)
        clearTimeout(request.timer)
        if (frame.error) {
          request.reject(new HermesRpcError(frame.error.code))
        } else if (frame.result && typeof frame.result === 'object') {
          request.resolve(frame.result)
        } else {
          request.reject(new Error('Invalid Hermes result'))
        }
      }
    }
  }
}
