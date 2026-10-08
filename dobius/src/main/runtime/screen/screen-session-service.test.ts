import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScreenSessionService, type ScreenCaptureFrame } from './screen-session-service'
import type { ScreenCapabilities, ScreenEvent, ScreenOwner, ScreenReference } from './screen-contracts'

afterEach(() => vi.useRealTimers())
function fixture() {
  vi.useFakeTimers()
  let granted = true
  let capture: ((frame: ScreenCaptureFrame) => void) | undefined
  const stop = vi.fn()
  const start = vi.fn((frame: (frame: ScreenCaptureFrame) => void) => {
    capture = frame
  })
  const backend = {
    supported: true,
    status: vi.fn(async (): Promise<ScreenCapabilities> => ({
      supported: true,
      permission: 'granted' as const,
      display: { id: 7, width: 1920, height: 1200 },
      maxFps: 10,
      maxWidth: 1280
    })),
    create: vi.fn(() => ({ start, stop }))
  }
  const service = new ScreenSessionService(backend, () =>
    granted ? { name: 'Stored phone', scope: 'mobile', grants: ['screen.view'] } : null
  )
  const hide = vi.fn()
  const approve = vi.fn(async (_name: string, _signal: AbortSignal) => true)
  const show = vi.fn(() => hide)
  service.setConsentUi({ approve, show, indicatorVisible: () => true })
  const abort = new AbortController()
  const sendBinary = vi.fn(() => true)
  const owner: ScreenOwner = {
    deviceId: 'phone',
    connectionId: 'socket',
    signal: abort.signal,
    sendBinary
  }
  const events: ScreenEvent[] = []
  const stream = () => service.stream({ fps: 3, width: 1280 }, owner, (event) => events.push(event))
  const ready = async () => {
    for (let i = 0; i < 12; i++) {
      await Promise.resolve()
    }
  }
  const image = new Uint8Array([
    0xff,
    0xd8,
    ...new TextEncoder().encode('PRIVATE_FRAME_SENTINEL'),
    0xff,
    0xd9
  ])
  const frame: ScreenCaptureFrame = { displayId: 7, width: 1280, height: 800, image }
  const ref = (): ScreenReference => events.find((event) => event.type === 'ready')!
  return {
    service,
    backend,
    start,
    stop,
    approve,
    show,
    hide,
    owner,
    abort,
    sendBinary,
    events,
    stream,
    ready,
    ref,
    frame,
    produce: () => capture!(frame),
    revoke: () => {
      granted = false
    }
  }
}

describe('desktop screen consented session safety', () => {
  it('shows the named-phone indicator and sends ready before a binary frame; excludes frames from JSON', async () => {
    const f = fixture()
    const task = f.stream()
    await f.ready()
    expect(f.approve.mock.calls[0][0]).toBe('Stored phone')
    expect(f.show).toHaveBeenCalledOnce()
    expect(f.events[0].type).toBe('ready')
    f.produce()
    expect(f.sendBinary).toHaveBeenCalledOnce()
    expect(JSON.stringify(f.events)).not.toContain('PRIVATE_FRAME_SENTINEL')
    f.service.stop('stopped')
    await task
    expect(f.stop).toHaveBeenCalledOnce()
    expect(f.hide).toHaveBeenCalledOnce()
  })
  it('reserves one viewer before consent and fences delayed approval on Stop', async () => {
    const f = fixture()
    let approve!: (allowed: boolean) => void
    f.approve.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          approve = resolve
        })
    )
    const task = f.stream()
    const rejection = expect(task).rejects.toMatchObject({ code: 'screen_not_authorized' })
    await f.ready()
    await expect(f.stream()).rejects.toMatchObject({ code: 'screen_busy' })
    f.service.stop('stopped')
    approve(true)
    await rejection
    await f.ready()
    expect(f.start).not.toHaveBeenCalled()
    expect(f.events).toEqual([])
  })
  it('does not capture or prompt when permission is missing', async () => {
    const f = fixture()
    f.backend.status.mockResolvedValue({
      supported: true,
      permission: 'missing',
      display: { id: 7, width: 1920, height: 1200 },
      maxFps: 10,
      maxWidth: 1280
    })
    await expect(f.stream()).rejects.toMatchObject({ code: 'screen_permission_missing' })
    expect(f.approve).not.toHaveBeenCalled()
    expect(f.start).not.toHaveBeenCalled()
  })
  it('rejects cross-phone and second-socket cleanup, then permits owner cleanup after grant loss', async () => {
    const f = fixture()
    const task = f.stream()
    await f.ready()
    for (const owner of [
      { ...f.owner, deviceId: 'other' },
      { ...f.owner, connectionId: 'second' }
    ]) {
      expect(() => f.service.unsubscribe(f.ref(), owner)).toThrow('Start viewing again')
    }
    f.revoke()
    expect(f.service.unsubscribe(f.ref(), f.owner)).toEqual({ unsubscribed: true })
    await task
  })
  it('expires without subscription-specific renewals and rejects renew after local Stop', async () => {
    const f = fixture()
    const task = f.stream()
    await f.ready()
    vi.advanceTimersByTime(30001)
    await task
    expect(f.stop).toHaveBeenCalledOnce()
    expect(() => f.service.renew(f.ref(), f.owner)).toThrow('Start viewing again')
    f.produce()
    expect(f.sendBinary).not.toHaveBeenCalled()
  })
  it('renews only the exact session and stops on revoke or connection abort', async () => {
    const f = fixture()
    const task = f.stream()
    await f.ready()
    vi.advanceTimersByTime(10000)
    f.service.renew(f.ref(), f.owner)
    vi.advanceTimersByTime(20001)
    expect(f.stop).not.toHaveBeenCalled()
    f.revoke()
    f.produce()
    await task
    expect(f.stop).toHaveBeenCalledOnce()
    const g = fixture()
    const next = g.stream()
    await g.ready()
    g.abort.abort()
    await next
    expect(g.stop).toHaveBeenCalledOnce()
  })
  it('stops rather than capture into congestion and never forwards late frames', async () => {
    const f = fixture()
    f.sendBinary.mockReturnValue(false)
    const task = f.stream()
    await f.ready()
    f.produce()
    await task
    expect(f.stop).toHaveBeenCalledOnce()
    f.produce()
    expect(f.sendBinary).toHaveBeenCalledOnce()
    expect(f.events.at(-1)).toMatchObject({ type: 'end', reason: 'congested' })
  })
  it('rejects oversized frames and changed displays and does not log sentinel image bytes', async () => {
    const f = fixture()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const task = f.stream()
    await f.ready()
    f.frame.image = new Uint8Array(1024 * 1024 + 1)
    f.produce()
    await task
    expect(f.sendBinary).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
    log.mockRestore()
  })
  it('waits for the visible indicator and fences Stop while it is loading', async () => {
    const f = fixture()
    let show!: (hide: () => void) => void
    f.service.setConsentUi({ approve: f.approve, indicatorVisible: () => true,
      show: () => new Promise<() => void>((resolve) => { show = resolve }) })
    const task = f.stream()
    const rejection = expect(task).rejects.toMatchObject({ code: 'screen_not_authorized' })
    await f.ready()
    expect(f.events).toEqual([])
    expect(f.start).not.toHaveBeenCalled()
    f.service.stop('stopped'); show(() => {}); await rejection
    expect(f.start).not.toHaveBeenCalled()
  })
  it('stops before a frame can be sent when the app and its indicator become hidden', async () => {
    const f = fixture()
    let visible = true
    f.service.setConsentUi({ approve: f.approve, show: f.show, indicatorVisible: () => visible })
    const task = f.stream(); await f.ready()
    visible = false; f.produce(); await task
    expect(f.stop).toHaveBeenCalledOnce()
    expect(f.sendBinary).not.toHaveBeenCalled()
  })
})
