import { afterEach, describe, expect, it, vi } from 'vitest'
import { DESKTOP_SCREEN_CAPABILITY } from '../../../src/shared/desktop-screen-protocol'
import type { RpcClient } from '../transport/rpc-client'
import { DesktopViewStore } from './desktop-view-store'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function fixture() {
  vi.useFakeTimers()
  let event!: (value: unknown) => void
  let frame!: NonNullable<Parameters<RpcClient['subscribe']>[3]>['onDesktopFrame']
  const unsubscribe = vi.fn()
  const sendRequest = vi.fn(async (method: string) => ({
    id: 'req',
    ok: true as const,
    result:
      method === 'status.get'
        ? { capabilities: [DESKTOP_SCREEN_CAPABILITY] }
        : { supported: true, permission: 'granted' }
  }))
  const subscribe = vi.fn(
    (
      _method: string,
      _params: unknown,
      onEvent: (value: unknown) => void,
      options: Parameters<RpcClient['subscribe']>[3]
    ) => {
      event = onEvent
      frame = options?.onDesktopFrame
      return unsubscribe
    }
  )
  const client = {
    onStateChange: vi.fn(() => () => {}),
    getState: () => 'connected',
    sendRequest,
    subscribe
  } as unknown as RpcClient
  const store = new DesktopViewStore()
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
    image: new Uint8Array([
      255,
      216,
      ...new TextEncoder().encode('PRIVATE_IMAGE_SENTINEL'),
      255,
      217
    ])
  }
  store.enterPage('host-a', client)
  return {
    client,
    store,
    ready,
    pixels,
    sendRequest,
    subscribe,
    unsubscribe,
    event: (value: unknown) => event(value),
    frame: (value: Parameters<NonNullable<typeof frame>>[0]) => frame!(value)
  }
}

describe('shared floating desktop mirror', () => {
  it('clears native surfaces synchronously on a host switch', async () => {
    const f = fixture()
    await f.store.start()
    f.event(f.ready)
    f.frame(f.pixels)
    f.store.showWidget()
    const clear = vi.fn()
    f.store.onClear(clear)
    f.store.routeChanged('host-b')
    expect(clear).toHaveBeenCalledOnce()
    expect(f.store.getSnapshot().image).toBeNull()
    expect(f.store.getSnapshot().widgetVisible).toBe(false)
    expect(f.unsubscribe).toHaveBeenCalledOnce()
  })

  it('observes disconnect after the page has unmounted without resuming', async () => {
    const f = fixture()
    await f.store.start()
    f.event(f.ready)
    f.frame(f.pixels)
    f.store.showWidget()
    f.store.leavePage('host-a')
    const callback = vi.mocked(f.client.onStateChange).mock.calls[0][0]
    callback('disconnected')
    expect(f.store.getSnapshot().image).toBeNull()
    expect(f.store.getSnapshot().badge).toBe('Reconnecting')
    callback('connected')
    expect(f.subscribe).toHaveBeenCalledOnce()
  })

  it('stops and clears an active mirror when Back leaves the desktop route', async () => {
    const f = fixture()
    await f.store.start()
    f.event(f.ready)
    f.frame(f.pixels)
    expect(f.store.getSnapshot().image).not.toBeNull()
    const clearNativeImage = vi.fn()
    f.store.onClear(clearNativeImage)

    // The route's useFocusEffect cleanup runs on Back navigation and unmount.
    f.store.leavePage('host-a')

    expect(f.unsubscribe).toHaveBeenCalledOnce()
    expect(clearNativeImage).toHaveBeenCalledOnce()
    expect(f.store.getSnapshot().image).toBeNull()
    expect(f.store.getSnapshot().badge).toBe('Paused')
    const renewalsAtExit = f.sendRequest.mock.calls.filter(
      ([method]) => method === 'screen.lease.renew'
    ).length
    vi.advanceTimersByTime(30000)
    expect(
      f.sendRequest.mock.calls.filter(([method]) => method === 'screen.lease.renew')
    ).toHaveLength(renewalsAtExit)
  })

  it('keeps one subscription while ownership moves between page and widget', async () => {
    const f = fixture()
    await f.store.start()
    f.event(f.ready)
    f.store.showWidget()
    f.store.leavePage('host-a')
    f.frame(f.pixels)
    expect(f.store.getSnapshot().image?.sequence).toBe(1)

    f.store.enterPage('host-a', f.client)
    f.store.handoffWidgetToPage('host-a')

    expect(f.subscribe).toHaveBeenCalledOnce()
    expect(f.unsubscribe).not.toHaveBeenCalled()
    expect(f.store.getSnapshot().widgetVisible).toBe(false)
    expect(f.store.getSnapshot().image).not.toBeNull()
    f.store.stop()
  })

  it('closes and unsubscribes when the widget × is pressed', async () => {
    const f = fixture()
    await f.store.start()
    f.event(f.ready)
    f.store.showWidget()
    f.store.leavePage('host-a')
    f.store.dismissWidget()

    expect(f.store.getSnapshot().widgetVisible).toBe(false)
    expect(f.store.getSnapshot().badge).toBe('Stopped')
    expect(f.unsubscribe).toHaveBeenCalledOnce()
  })

  it('stops on background and clears the image reference', async () => {
    const f = fixture()
    await f.store.start()
    f.event(f.ready)
    f.frame(f.pixels)
    expect(f.store.getSnapshot().image).not.toBeNull()
    const clearNativeImage = vi.fn()
    f.store.onClear(clearNativeImage)

    f.store.setAppActive(false)

    expect(f.store.getSnapshot().image).toBeNull()
    expect(clearNativeImage).toHaveBeenCalledOnce()
    expect(f.store.getSnapshot().badge).toBe('Paused')
    expect(f.unsubscribe).toHaveBeenCalledOnce()
  })

  it('shows Mac Stop as Stopped and does not automatically resume', async () => {
    const f = fixture()
    await f.store.start()
    f.event(f.ready)
    f.store.showWidget()
    f.event({ type: 'end', reason: 'stopped_by_desktop' })
    vi.advanceTimersByTime(40000)

    expect(f.store.getSnapshot().badge).toBe('Stopped')
    expect(f.store.getSnapshot().image).toBeNull()
    expect(f.subscribe).toHaveBeenCalledOnce()
  })

  it('stops lease renewal when the widget closes on another page', async () => {
    const f = fixture()
    await f.store.start()
    f.event(f.ready)
    f.store.showWidget()
    f.store.leavePage('host-a')
    vi.advanceTimersByTime(10000)
    const renewalsBeforeClose = f.sendRequest.mock.calls.filter(
      ([method]) => method === 'screen.lease.renew'
    ).length
    f.store.dismissWidget()
    vi.advanceTimersByTime(40000)
    const renewalsAfterClose = f.sendRequest.mock.calls.filter(
      ([method]) => method === 'screen.lease.renew'
    ).length

    expect(renewalsAfterClose).toBe(renewalsBeforeClose)
    expect(f.unsubscribe).toHaveBeenCalledOnce()
  })
})
