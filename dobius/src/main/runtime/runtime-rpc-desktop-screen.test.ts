import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebSocket } from 'ws'
import { DobiusRuntimeRpcServer } from './runtime-rpc'
import type { DeviceEntry, DeviceRegistry } from './device-registry'
import type { DobiusRuntimeService } from './dobius-runtime'
import { ScreenSessionService } from './screen/screen-session-service'
import type { RpcResponse } from './rpc/core'
import type { ScreenReference } from './screen/screen-contracts'

afterEach(() => vi.useRealTimers())

function fixture() {
  vi.useFakeTimers()
  const phone: DeviceEntry = {
    deviceId: 'stable-phone-id',
    token: 'paired-bearer-token',
    name: 'Stored phone',
    scope: 'mobile',
    grants: ['screen.view'],
    pairedAt: 1,
    lastSeenAt: 1
  }
  const other: DeviceEntry = { ...phone, deviceId: 'other-phone-id', token: 'other-token' }
  const devices = [phone, other]
  const getDevice = (id: string) => devices.find((device) => device.deviceId === id) ?? null
  const stop = vi.fn()
  const start = vi.fn()
  const approve = vi.fn(async () => true)
  const screen = new ScreenSessionService(
    {
      supported: true,
      status: async () => ({
        supported: true,
        permission: 'granted',
        display: { id: 1, width: 1440, height: 900 },
        maxFps: 10,
        maxWidth: 1280
      }),
      create: () => ({ start, stop })
    },
    getDevice
  )
  screen.setConsentUi({ approve, show: () => () => {}, indicatorVisible: () => true })
  const runtime = {
    getRuntimeId: () => 'host',
    desktopScreen: screen
  } as unknown as DobiusRuntimeService
  const server = new DobiusRuntimeRpcServer({ runtime, userDataPath: process.cwd() })
  server['deviceRegistry'] = {
    getDevice,
    validateToken: (token: string) => devices.find((device) => device.token === token) ?? null
  } as unknown as DeviceRegistry
  const socket = (id: string): WebSocket => {
    const ws = Object.assign(new EventEmitter(), { OPEN: 1, readyState: 1 }) as unknown as WebSocket
    server['wsConnectionIds'].set(ws, id)
    return ws
  }
  const ws = socket('owner-socket')
  let counter = 0
  const request = (method: string, params: unknown = {}, device = phone, connection = ws) => {
    const replies: RpcResponse[] = []
    const done = server['handleWebSocketMessage'](
      JSON.stringify({ id: `request-${++counter}`, method, params }),
      (reply) => replies.push(JSON.parse(reply) as RpcResponse),
      () => true,
      undefined,
      connection,
      device.token
    )
    return { replies, done }
  }
  const call = async (...args: Parameters<typeof request>) => {
    const { replies, done } = request(...args)
    await done
    return replies[0]
  }
  const ready = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  }
  return { phone, other, screen, socket, request, call, ready, approve, start, stop }
}

describe('screen authorization through the authenticated WebSocket dispatcher', () => {
  it('uses the stable registry ID for capabilities, streaming, renewal and owner cleanup', async () => {
    const f = fixture()
    expect(await f.call('screen.capabilities')).toMatchObject({
      ok: true,
      result: { supported: true }
    })
    const stream = f.request('screen.stream')
    try {
      await f.ready()
      expect(stream.replies[0]).toMatchObject({ ok: true, result: { type: 'ready' } })
      expect(f.approve).toHaveBeenCalledWith('Stored phone', expect.any(AbortSignal))
      expect(f.start).toHaveBeenCalledOnce()
      const ready = (stream.replies[0] as { result: ScreenReference }).result
      const ref = { subscriptionId: ready.subscriptionId, generation: ready.generation }
      expect(await f.call('screen.lease.renew', ref)).toMatchObject({ ok: true })
      for (const [device, connection] of [
        [f.other, f.socket('other-socket')],
        [f.phone, f.socket('second-socket')]
      ] as const) {
        for (const method of ['screen.lease.renew', 'screen.stream.unsubscribe']) {
          expect(await f.call(method, ref, device, connection)).toMatchObject({
            ok: false,
            error: { code: 'screen_not_authorized' }
          })
        }
      }
      expect(f.stop).not.toHaveBeenCalled()
      f.phone.grants = []
      expect(await f.call('screen.stream.unsubscribe', ref)).toMatchObject({ ok: true })
      expect(f.stop).toHaveBeenCalledOnce()
    } finally {
      f.screen.stop('shutdown')
      await stream.done
    }
  })

  it('denies viewing methods without a grant before any consent or capture', async () => {
    const f = fixture()
    f.phone.grants = []
    for (const method of ['screen.capabilities', 'screen.stream', 'screen.lease.renew']) {
      expect(await f.call(method)).toMatchObject({ ok: false, error: { code: 'forbidden' } })
    }
    expect(f.approve).not.toHaveBeenCalled()
    expect(f.start).not.toHaveBeenCalled()
  })

  it('does not renew the viewing lease for unrelated RPC traffic', async () => {
    const f = fixture()
    const stream = f.request('screen.stream')
    try {
      await f.ready()
      expect(f.start).toHaveBeenCalledOnce()
      for (let i = 0; i < 3; i++) {
        vi.advanceTimersByTime(10000)
        await f.call('screen.capabilities')
      }
      expect(f.stop).toHaveBeenCalledOnce()
      expect(stream.replies.at(-1)).toMatchObject({ result: { type: 'end', reason: 'expired' } })
    } finally {
      f.screen.stop('shutdown')
      await stream.done
    }
  })
})
