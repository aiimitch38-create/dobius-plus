import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopViewController } from './desktop-view-controller'
import type { RpcClient } from '../transport/rpc-client'
import { DESKTOP_SCREEN_CAPABILITY } from '../../../src/shared/desktop-screen-protocol'
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
function fixture(capabilities = [DESKTOP_SCREEN_CAPABILITY]) {
  vi.useFakeTimers()
  let visible = true
  let event!: (value: unknown) => void
  let frame!: NonNullable<Parameters<RpcClient['subscribe']>[3]>['onDesktopFrame']
  const unsubscribe = vi.fn()
  const sendRequest = vi.fn(async (method: string) => ({
    id: 'req',
    ok: true as const,
    result: method === 'status.get' ? { capabilities } : { supported: true, permission: 'granted' }
  }))
  const subscribe = vi.fn(
    (
      _: string,
      _params: unknown,
      onEvent: (value: unknown) => void,
      options: Parameters<RpcClient['subscribe']>[3]
    ) => {
      event = onEvent
      frame = options?.onDesktopFrame
      return unsubscribe
    }
  )
  const client = { getState: () => 'connected', sendRequest, subscribe } as unknown as RpcClient
  const callbacks = {
    visible: () => visible,
    clear: vi.fn(),
    frame: vi.fn(),
    badge: vi.fn(),
    message: vi.fn()
  }
  const controller = new DesktopViewController(client, callbacks)
  return {
    controller,
    callbacks,
    sendRequest,
    subscribe,
    unsubscribe,
    event: (value: unknown) => event(value),
    frame: (value: Parameters<NonNullable<typeof frame>>[0]) => frame!(value),
    hide: () => {
      visible = false
      controller.stop('Paused')
    }
  }
}
const ready = {
  type: 'ready',
  subscriptionId: '00000000-0000-4000-8000-000000000001',
  generation: '00000000-0000-4000-8000-000000000002',
  displayId: 7,
  width: 1280,
  height: 800
}
const pixels = {
  ...ready,
  sequence: 1,
  image: new Uint8Array([255, 216, ...new TextEncoder().encode('PRIVATE_IMAGE_SENTINEL'), 255, 217])
}
describe('foreground phone desktop viewing', () => {
  it('handles old desktops before sending any screen RPC', async () => {
    const f = fixture([])
    await f.controller.start()
    expect(f.sendRequest).toHaveBeenCalledTimes(1)
    expect(f.subscribe).not.toHaveBeenCalled()
    expect(f.callbacks.message).toHaveBeenCalledWith(expect.stringContaining('Update desktop'))
  })
  it('renews only while visible and clears pixels / callbacks on background with no automatic resume', async () => {
    const f = fixture()
    await f.controller.start()
    f.event(ready)
    f.frame(pixels)
    expect(f.callbacks.frame).toHaveBeenCalledOnce()
    expect(f.sendRequest).toHaveBeenCalledWith('screen.lease.renew', {
      subscriptionId: ready.subscriptionId,
      generation: ready.generation
    })
    f.hide()
    const requests = f.sendRequest.mock.calls.length
    vi.advanceTimersByTime(40000)
    f.frame({ ...pixels, sequence: 2 })
    expect(f.sendRequest).toHaveBeenCalledTimes(requests)
    expect(f.unsubscribe).toHaveBeenCalledOnce()
    expect(f.callbacks.clear).toHaveBeenCalledTimes(2)
    expect(f.callbacks.frame).toHaveBeenCalledOnce()
    expect(f.subscribe).toHaveBeenCalledOnce()
  })
  it('shows Live only after image load and logs only safe counters/times', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const f = fixture()
    await f.controller.start()
    f.event(ready)
    f.frame(pixels)
    expect(f.callbacks.badge).not.toHaveBeenCalledWith('Live')
    f.controller.imageLoaded(1)
    expect(f.callbacks.badge).toHaveBeenCalledWith('Live')
    expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE_IMAGE_SENTINEL')
    f.controller.stop()
  })
  it('requests the supported 10 FPS capture rate for smoother phone viewing', async () => {
    const f = fixture()
    await f.controller.start()
    expect(f.subscribe.mock.calls[0][1]).toEqual({ fps: 10, width: 1280 })
    f.controller.stop()
  })
  it('preserves typed screen permission instructions and keeps Stop latched until a new start', async () => {
    const f = fixture()
    await f.controller.start()
    f.event({ type: 'error', error: { code: 'screen_permission_missing' } })
    expect(f.callbacks.message).toHaveBeenCalledWith(
      expect.stringContaining('Enable screen sharing')
    )
    expect(f.callbacks.badge).toHaveBeenLastCalledWith('Stopped')
    vi.advanceTimersByTime(40000)
    expect(f.subscribe).toHaveBeenCalledOnce()
  })
})
