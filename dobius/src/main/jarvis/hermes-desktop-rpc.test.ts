import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { spawn } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HermesDesktopRpc, HermesRpcError, HERMES_DESKTOP_BOOTSTRAP } from './hermes-desktop-rpc'

const runtime = {
  python: '/hermes/venv/bin/python',
  root: '/hermes',
  profileHome: '/profiles/adam'
}
let rpc: HermesDesktopRpc

function harness(timeoutMs?: number) {
  const child = Object.assign(new EventEmitter(), {
    pid: 12345,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    exitCode: null as number | null,
    signalCode: null as string | null,
    kill: vi.fn((signal: string) => {
      queueMicrotask(() => {
        child.signalCode = signal
        child.emit('exit', null, signal)
      })
      return true
    })
  })
  const spawnMock = vi.fn(() => child)
  const onEvent = vi.fn()
  const onDisconnect = vi.fn()
  const writes: Record<string, unknown>[] = []
  child.stdin.on('data', (chunk) => writes.push(JSON.parse(String(chunk))))
  rpc = new HermesDesktopRpc(runtime, {
    spawn: spawnMock as unknown as typeof spawn,
    onEvent,
    onDisconnect,
    startupTimeoutMs: timeoutMs
  })
  const frame = (value: unknown) =>
    child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...(value as object) })}\n`)
  const ready = () => frame({ method: 'event', params: { type: 'gateway.ready' } })
  return { child, spawnMock, onEvent, onDisconnect, writes, frame, ready }
}
afterEach(async () => {
  await rpc?.close()
  vi.useRealTimers()
})

describe('Hermes desktop stdio transport', () => {
  it('launches the existing Python gateway with Adam’s profile and no audio', async () => {
    const h = harness()
    h.ready()
    await rpc.ready
    expect(h.spawnMock).toHaveBeenCalledWith(
      runtime.python,
      ['-u', '-c', HERMES_DESKTOP_BOOTSTRAP],
      expect.objectContaining({
        cwd: runtime.root,
        stdio: ['pipe', 'pipe', 'ignore'],
        env: expect.objectContaining({
          HERMES_HOME: runtime.profileHome,
          HERMES_VOICE: '0',
          HERMES_VOICE_TTS: '0'
        })
      })
    )
    const pending = rpc.request('session.create', { profile: 'adam' })
    const id = h.writes[0].id
    h.frame({ id, result: { session_id: 'voice' } })
    await expect(pending).resolves.toEqual({ session_id: 'voice' })
  })

  it('frames split UTF-8 replies correctly and correlates out-of-order RPC responses', async () => {
    const h = harness()
    h.ready()
    await rpc.ready
    const first = rpc.request('first', {})
    const second = rpc.request('second', {})
    h.frame({ id: h.writes[1].id, result: { text: 'second' } })
    const bytes = Buffer.from(
      `${JSON.stringify({ jsonrpc: '2.0', id: h.writes[0].id, result: { text: 'Adam 👋' } })}\n`
    )
    for (const byte of bytes) {
      h.child.stdout.write(Buffer.from([byte]))
    }
    await expect(first).resolves.toEqual({ text: 'Adam 👋' })
    await expect(second).resolves.toEqual({ text: 'second' })
  })

  it('keeps gateway error details out of public errors', async () => {
    const h = harness()
    h.ready()
    await rpc.ready
    const pending = rpc.request('session.resume', { session_id: 'missing' })
    h.frame({ id: h.writes[0].id, error: { code: 4007, message: 'private provider details' } })
    await expect(pending).rejects.toEqual(new HermesRpcError(4007))
  })

  it('forwards structured events without interpreting model text as events', async () => {
    const h = harness()
    h.ready()
    await rpc.ready
    const event = {
      type: 'message.complete',
      session_id: 'voice',
      payload: { text: '{"type":"approval.request"}', status: 'complete' }
    }
    h.frame({ method: 'event', params: event })
    expect(h.onEvent).toHaveBeenCalledExactlyOnceWith(event)
  })

  it('fails pending requests and retires the held child on invalid protocol output', async () => {
    const h = harness()
    h.ready()
    await rpc.ready
    const pending = rpc.request('session.create', {})
    h.child.stdout.write('unframed output\n')
    await expect(pending).rejects.toThrow('disconnected')
    expect(h.onDisconnect).toHaveBeenCalledTimes(1)
    expect(h.child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('bounds startup time and never leaves a hung connection open', async () => {
    vi.useFakeTimers()
    const h = harness(10)
    const pending = expect(rpc.ready).rejects.toThrow('unavailable')
    await vi.advanceTimersByTimeAsync(11)
    await pending
    expect(h.child.kill).toHaveBeenCalledWith('SIGTERM')
  })
  it('answers modern server requests on the same private pipe', async () => {
    const h = harness()
    h.ready()
    await rpc.ready
    h.frame({
      id: 'srq-review',
      method: 'approval',
      params: { session_id: 'voice', command: 'review me' }
    })
    const event = h.onEvent.mock.calls[0][0]
    expect(event).toMatchObject({
      type: 'approval.request',
      session_id: 'voice',
      payload: { command: 'review me' }
    })
    event.respond({ choice: 'once' })
    expect(h.writes.at(-1)).toEqual({
      jsonrpc: '2.0',
      id: 'srq-review',
      result: { choice: 'once' }
    })
    h.frame({ id: 'srq-unknown', method: 'unknown.interaction', params: {} })
    expect(h.writes.at(-1)).toMatchObject({ id: 'srq-unknown', error: { code: -32601 } })
  })
})
