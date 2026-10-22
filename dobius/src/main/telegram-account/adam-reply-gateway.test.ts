import { EventEmitter } from 'node:events'
import { Duplex } from 'node:stream'
import type { spawn, ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { AdamReplyGateway } from './adam-reply-gateway'
import { AdamBridgeFrameReader, ADAM_BRIDGE_FRAME_LIMIT } from './adam-bridge-protocol'

function fixture(options: { ready?: boolean; nonce?: string } = {}) {
  const sent: Record<string, unknown>[] = []
  const child = new EventEmitter() as ChildProcess
  const channel = new Duplex({
    read() {},
    write(bytes, _encoding, done) {
      const frame = JSON.parse(bytes.toString())
      sent.push(frame)
      if (frame.type === 'hello' && options.ready !== false) {
        queueMicrotask(() =>
          send({
            v: 1,
            type: 'ready',
            nonce: options.nonce ?? frame.nonce,
            profile: 'adam',
            platform: 'dobius_adam_telegram',
            policy: 'no-tools'
          })
        )
      }
      done()
    }
  })
  const send = (frame: Record<string, unknown>): void => {
    channel.push(Buffer.from(`${JSON.stringify(frame)}\n`))
  }
  Object.assign(child, {
    stdio: [null, null, null, channel],
    exitCode: null,
    signalCode: null,
    kill: vi.fn(() => {
      queueMicrotask(() => {
        Object.assign(child, { signalCode: 'SIGTERM' })
        child.emit('exit', null, 'SIGTERM')
      })
      return true
    })
  })
  const spawnChild = vi.fn(() => child)
  const gateway = new AdamReplyGateway({
    runtime: () => ({
      python: '/trusted/venv/bin/python',
      runner: '/trusted/bridge_runner.py',
      hermesRoot: '/trusted/hermes',
      profileHome: '/trusted/profiles/adam'
    }),
    accountId: () => '123',
    spawn: spawnChild as unknown as typeof spawn,
    startupTimeoutMs: 200
  })
  return { gateway, child, channel, send, sent, spawnChild }
}

function request(signal = new AbortController().signal) {
  return {
    agentId: 'adam' as const,
    group: { id: '-101', title: 'Selected group', kind: 'group' as const },
    senderId: '456',
    messageId: '78',
    text: 'Synthetic approved message',
    signal
  }
}

describe('Adam parent-owned reply gateway', () => {
  it('does not spawn when Stop overtakes a queued startup', async () => {
    const f = fixture()
    const start = f.gateway.start()
    await f.gateway.stop()
    await expect(start).rejects.toThrow('stale-operation')
    expect(f.spawnChild).not.toHaveBeenCalled()
    expect(f.gateway.status()).toBe('unavailable')
  })

  it('retires a child that never finishes its startup handshake', async () => {
    const f = fixture({ ready: false })
    await expect(f.gateway.start()).rejects.toThrow('client-unavailable')
    expect(f.gateway.status()).toBe('error')
    expect(f.child.kill).toHaveBeenCalledWith('SIGTERM')
    await f.gateway.stop()
  })

  it('bounds outstanding requests and settles the admitted queue on Stop', async () => {
    const f = fixture()
    await f.gateway.start()
    const pending = Array.from({ length: 32 }, (_, index) =>
      f.gateway
        .reply({ ...request(), messageId: String(index + 1) })
        .catch((error: Error) => error.message)
    )
    await expect(f.gateway.reply({ ...request(), messageId: '100' })).rejects.toThrow(
      'client-unavailable'
    )
    expect(f.sent.filter((frame) => frame.type === 'request')).toHaveLength(32)
    await f.gateway.stop()
    expect(await Promise.all(pending)).toEqual(Array(32).fill('client-unavailable'))
  })

  it('uses the private child FD with no secrets in arguments and requires policy-bound handshake', async () => {
    const f = fixture()
    await f.gateway.start()
    expect(f.gateway.status()).toBe('ready')
    const [command, args, options] = f.spawnChild.mock.calls[0] as unknown as [
      string,
      string[],
      { stdio: string[] }
    ]
    expect(command).toBe('/trusted/venv/bin/python')
    expect(args).toEqual([
      '/trusted/bridge_runner.py',
      '--hermes-root',
      '/trusted/hermes',
      '--profile-home',
      '/trusted/profiles/adam'
    ])
    expect(options.stdio).toEqual(['ignore', 'ignore', 'ignore', 'pipe'])
    expect(args.join(' ')).not.toContain(String(f.sent[0].nonce))
    await f.gateway.stop()
  })

  it('refuses a mismatched ready nonce and retires that exact process', async () => {
    const f = fixture({ nonce: 'x'.repeat(43) })
    await expect(f.gateway.start()).rejects.toThrow('client-unavailable')
    expect(f.gateway.status()).toBe('error')
    expect(f.child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('correlates the final reply and uses a stable account/message/payload request identity', async () => {
    const f = fixture()
    await f.gateway.start()
    const first = f.gateway.reply(request())
    const id = f.sent.at(-1)!.id
    expect(id).toMatch(/^tg_[a-f0-9]{64}$/)
    f.send({ v: 1, type: 'reply', id, text: 'Draft for approval' })
    await expect(first).resolves.toBe('Draft for approval')
    const again = f.gateway.reply(request())
    expect(f.sent.at(-1)!.id).toBe(id)
    f.send({ v: 1, type: 'reply', id, text: 'Draft for approval' })
    await again
    await f.gateway.stop()
  })

  it('rejects duplicate in-flight requests and fences an aborted turn until its terminal receipt', async () => {
    const f = fixture()
    await f.gateway.start()
    const controller = new AbortController()
    const pending = f.gateway.reply(request(controller.signal))
    const rejected = expect(pending).rejects.toThrow('stale-operation')
    await expect(f.gateway.reply(request())).rejects.toThrow('stale-operation')
    const id = f.sent.at(-1)!.id
    controller.abort()
    await rejected
    expect(f.sent.at(-1)).toEqual({ v: 1, type: 'cancel', id })
    f.send({ v: 1, type: 'error', id, code: 'cancelled' })
    expect(f.gateway.status()).toBe('ready')
    await f.gateway.stop()
  })

  it('rejects unsolicited or late replies rather than publishing another turn’s content', async () => {
    const f = fixture()
    await f.gateway.start()
    const pending = f.gateway.reply(request())
    const refused = expect(pending).rejects.toThrow('client-unavailable')
    f.send({ v: 1, type: 'reply', id: `tg_${'f'.repeat(64)}`, text: 'Uncorrelated body' })
    await refused
    expect(f.gateway.status()).toBe('error')
    await f.gateway.stop()
  })

  it('does not pretend a closed child remains ready and settles every pending caller', async () => {
    const f = fixture()
    await f.gateway.start()
    const pending = f.gateway.reply(request())
    const refused = expect(pending).rejects.toThrow('client-unavailable')
    f.child.emit('exit', 1)
    await refused
    expect(f.gateway.status()).toBe('error')
    await f.gateway.stop()
  })
})

describe('Adam wire framing', () => {
  it('handles split Unicode frames and rejects unbounded, malformed, or extra-field output', () => {
    const consume = vi.fn()
    const reader = new AdamBridgeFrameReader(consume)
    const bytes = Buffer.from(
      `${JSON.stringify({ v: 1, type: 'reply', id: `tg_${'a'.repeat(64)}`, text: 'Hello 🌍' })}\n`
    )
    for (const byte of bytes) {
      reader.push(Buffer.from([byte]))
    }
    expect(consume).toHaveBeenCalledOnce()
    expect(() =>
      new AdamBridgeFrameReader(consume).push(Buffer.alloc(ADAM_BRIDGE_FRAME_LIMIT + 1))
    ).toThrow('protocol-error')
    expect(() => reader.push(Buffer.from('{"v":1,"type":"error","code":"raw-secret"}\n'))).toThrow(
      'protocol-error'
    )
    expect(() => reader.push(Buffer.from([255, 10]))).toThrow()
  })
})
