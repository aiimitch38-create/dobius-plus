import { describe, expect, it, vi } from 'vitest'
import { DesktopScreenStreamRouting } from './desktop-screen-stream-routing'
import { encodeDesktopScreenFrame } from '../../../src/shared/desktop-screen-protocol'
import { decodeBrowserScreencastFrame } from './browser-screencast-protocol'
const ready = {
  type: 'ready' as const,
  subscriptionId: '00000000-0000-4000-8000-000000000001',
  generation: '00000000-0000-4000-8000-000000000002',
  displayId: 7,
  width: 1280,
  height: 800
}
const frame = { ...ready, sequence: 1, image: new Uint8Array([255, 216, 255, 217]) }
describe('phone desktop stream routing', () => {
  it('keeps desktop pixels out of browser routing, and drops pre-ready, stale and wrong-generation frames', () => {
    const onFrame = vi.fn(),
      unsubscribe = vi.fn(),
      remove = vi.fn()
    const route = new DesktopScreenStreamRouting(unsubscribe, remove)
    route.register('desktop', vi.fn(), onFrame)
    const bytes = encodeDesktopScreenFrame(frame)
    expect(decodeBrowserScreencastFrame(bytes)).toBeNull()
    route.binary(bytes)
    expect(onFrame).not.toHaveBeenCalled()
    route.ready('desktop', ready)
    route.binary(bytes)
    expect(onFrame).toHaveBeenCalledOnce()
    route.binary(bytes)
    route.binary(
      encodeDesktopScreenFrame({ ...frame, sequence: 2, generation: ready.subscriptionId })
    )
    expect(onFrame).toHaveBeenCalledOnce()
  })
  it('cancel-before-ready retains no callbacks and sends screen-specific unsubscribe on late ready', () => {
    const event = vi.fn(),
      onFrame = vi.fn(),
      unsubscribe = vi.fn(),
      remove = vi.fn()
    const route = new DesktopScreenStreamRouting(unsubscribe, remove)
    route.register('pending', event, onFrame)
    route.cancel('pending', true)
    route.ready('pending', ready)
    route.binary(encodeDesktopScreenFrame(frame))
    expect(unsubscribe).toHaveBeenCalledWith(ready)
    expect(remove).toHaveBeenCalledWith('pending')
    expect(event).not.toHaveBeenCalled()
    expect(onFrame).not.toHaveBeenCalled()
  })
  it('disconnect ends the session and drops frames until an explicit new registration', () => {
    const onFrame = vi.fn(),
      event = vi.fn(),
      remove = vi.fn()
    const route = new DesktopScreenStreamRouting(vi.fn(), remove)
    route.register('desktop', event, onFrame)
    route.ready('desktop', ready)
    route.disconnected()
    route.binary(encodeDesktopScreenFrame(frame))
    expect(onFrame).not.toHaveBeenCalled()
    expect(event).toHaveBeenLastCalledWith({ type: 'end', reason: 'disconnected' })
    expect(remove).toHaveBeenCalledWith('desktop')
  })
  it('cleans up orphan ready replies even after a tombstone was bounded out', () => {
    const unsubscribe = vi.fn()
    const route = new DesktopScreenStreamRouting(unsubscribe, vi.fn())
    for (let i = 0; i < 40; i++) {
      route.register(String(i), vi.fn())
      route.cancel(String(i), true)
    }
    route.ready('0', ready)
    expect(unsubscribe).toHaveBeenCalledWith(ready)
  })
  it('sends pending cancellation immediately and does not reset ordering on duplicate ready', () => {
    const cancel = vi.fn(),
      frameCallback = vi.fn()
    const route = new DesktopScreenStreamRouting(vi.fn(), vi.fn(), cancel)
    route.register('pending', vi.fn())
    route.cancel('pending', true)
    expect(cancel).toHaveBeenCalledWith('pending')
    route.register('live', vi.fn(), frameCallback)
    route.ready('live', ready)
    route.binary(encodeDesktopScreenFrame(frame))
    route.ready('live', ready)
    route.binary(encodeDesktopScreenFrame(frame))
    expect(frameCallback).toHaveBeenCalledOnce()
  })
})
