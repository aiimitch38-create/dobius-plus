import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import {
  DIRECTORY_BRIDGE_PENDING_LIMIT,
  DIRECTORY_BRIDGE_TIMEOUT_LIMIT,
  DIRECTORY_BRIDGE_WIRE_LIMIT,
  DescriptorDirectoryBridgeError,
  isDirectoryBridgeReply,
  type DirectoryBridgeReply
} from './descriptor-directory-protocol'

type Pending = { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }
export type DescriptorDirectoryTransportOptions = {
  pythonExecutable: string
  scriptPath: string
  operationTimeoutMs?: number
}

export class DescriptorDirectoryTransport {
  private child: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private sequence = 0
  private dead = false
  private closing = false
  private confirmedExit = true
  private readonly pending = new Map<string, Pending>()
  private exit: Promise<void> = Promise.resolve()
  private resolveExit = () => {}
  private disposing: Promise<void> | null = null
  private readonly timeout: number
  private readonly epoch = randomUUID()

  constructor(private readonly options: DescriptorDirectoryTransportOptions) {
    this.timeout = Math.min(
      DIRECTORY_BRIDGE_TIMEOUT_LIMIT,
      Math.max(1, options.operationTimeoutMs ?? 1000)
    )
  }

  get cleanupConfirmed(): boolean {
    return this.confirmedExit
  }

  get isDead(): boolean {
    return this.dead
  }

  get isClosing(): boolean {
    return this.closing
  }

  /** Stable incarnation token while this exact helper child is alive and usable. */
  get previewHelperEpoch(): string | null {
    const child = this.child
    if (
      !child ||
      this.dead ||
      this.closing ||
      this.confirmedExit ||
      !child.stdin.writable ||
      !child.stdout.readable ||
      child.exitCode !== null ||
      child.signalCode !== null
    ) {
      return null
    }
    return this.epoch
  }

  request<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.requestInternal<T>(op, args, false)
  }

  private requestInternal<T>(
    op: string,
    args: Record<string, unknown>,
    allowClosing: boolean
  ): Promise<T> {
    if (this.dead || (this.closing && !allowClosing)) {
      return Promise.reject(this.error('unavailable', 'Bridge is closed.'))
    }
    if (!this.child) {
      this.start()
    }
    const child = this.child
    if (!child?.stdin.writable) {
      return Promise.reject(this.error('unavailable', 'Bridge input is closed.'))
    }
    if (this.pending.size >= DIRECTORY_BRIDGE_PENDING_LIMIT) {
      return Promise.reject(this.error('pending_limit', 'Too many pending bridge operations.'))
    }
    const id = String(++this.sequence)
    const data = Buffer.from(`${JSON.stringify({ ...args, id, op })}\n`)
    if (data.byteLength > DIRECTORY_BRIDGE_WIRE_LIMIT) {
      return Promise.reject(this.error('request_limit', 'Bridge request exceeds its size limit.'))
    }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail('timeout', 'Bridge request timed out.'),
        this.timeout
      )
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer })
      child.stdin.write(data, (error) => {
        if (error) {
          this.fail('io', 'Bridge request write failed.')
        }
      })
    })
  }

  async cancel(): Promise<void> {
    if (!this.dead) {
      this.fail('cancelled', 'Bridge was cancelled.')
    }
    await this.waitForExit(250)
  }

  dispose(): Promise<void> {
    if (!this.disposing) {
      this.disposing = (async () => {
        this.closing = true
        if (!this.child) {
          this.dead = true
          return
        }
        if (!this.dead && this.child.exitCode === null) {
          try {
            await Promise.race([
              this.requestInternal('shutdown', {}, true).then(
                () => true,
                () => false
              ),
              this.wait(250).then(() => false)
            ])
          } catch {}
        }
        if (this.child?.exitCode === null && this.child?.signalCode === null) {
          this.fail('disposed', 'Bridge was disposed.')
        }
        await this.waitForExit(250)
      })()
    }
    return this.disposing
  }

  private start(): void {
    if (!isAbsolute(this.options.pythonExecutable) || !isAbsolute(this.options.scriptPath)) {
      throw this.error('configuration', 'Interpreter and bridge paths must be absolute.')
    }
    const child = spawn(this.options.pythonExecutable, ['-I', '-B', this.options.scriptPath], {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.child = child
    this.confirmedExit = false
    this.exit = new Promise((resolve) => (this.resolveExit = resolve))
    child.stdout.setEncoding('utf8').on('data', (part: string) => this.receive(part))
    child.stderr.resume()
    child.on('error', () => this.fail('spawn', 'Bridge process failed to start.'))
    child.on('exit', () => {
      this.confirmedExit = true
      this.resolveExit()
      if (!this.dead) {
        this.fail('exit', 'Bridge process exited unexpectedly.')
      }
    })
  }

  private receive(part: string): void {
    if (this.dead) {
      return
    }
    this.buffer += part
    let newline: number
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      if (Buffer.byteLength(line) > DIRECTORY_BRIDGE_WIRE_LIMIT) {
        this.fail('response_limit', 'Bridge response exceeds its size limit.')
        return
      }
      let reply: DirectoryBridgeReply
      try {
        const decoded: unknown = JSON.parse(line)
        if (!isDirectoryBridgeReply(decoded)) {
          throw new Error('invalid response')
        }
        reply = decoded
      } catch {
        this.fail('protocol', 'Bridge returned an invalid response.')
        return
      }
      const pending = this.pending.get(reply.id)
      if (!pending) {
        continue
      }
      clearTimeout(pending.timer)
      this.pending.delete(reply.id)
      if (reply.ok) {
        pending.resolve(reply.result)
      } else {
        pending.reject(this.error(reply.error ?? 'operation_failed', 'Bridge operation failed.'))
      }
    }
    if (Buffer.byteLength(this.buffer) > DIRECTORY_BRIDGE_WIRE_LIMIT) {
      this.fail('response_limit', 'Bridge response exceeds its size limit.')
    }
  }

  private fail(code: string, message: string): void {
    if (this.dead) {
      return
    }
    this.dead = true
    this.buffer = ''
    const error = this.error(code, message)
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    this.pending.clear()
    if (this.child?.pid && this.child.exitCode === null && this.child.signalCode === null) {
      this.confirmedExit = false
      this.child.kill('SIGKILL')
    } else {
      this.confirmedExit = true
      this.resolveExit()
    }
  }

  private wait(durationMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, durationMs))
  }

  private async waitForExit(durationMs: number): Promise<void> {
    await Promise.race([this.exit, this.wait(durationMs)])
  }

  private error(code: string, message: string): DescriptorDirectoryBridgeError {
    return new DescriptorDirectoryBridgeError(message, code)
  }
}
