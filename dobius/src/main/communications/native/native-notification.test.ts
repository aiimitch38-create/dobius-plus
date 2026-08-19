import { describe, expect, it, vi } from 'vitest'
import { showNativeNotification, type NativeNotificationHandle } from './native-notification'

function fakeHandle(): NativeNotificationHandle & { listeners: Record<string, () => void> } {
  const listeners: Record<string, () => void> = {}
  return {
    listeners,
    show: vi.fn(),
    on: vi.fn((event: string, listener: () => void) => {
      listeners[event] = listener
    })
  }
}

describe('showNativeNotification', () => {
  it('reports shown:false instead of throwing when notifications are unsupported', () => {
    const result = showNativeNotification(
      { title: 't', body: 'b' },
      { isSupported: () => false, createNotification: vi.fn() }
    )
    expect(result).toEqual({ shown: false })
  })

  it('creates and shows a notification with the given title and body', () => {
    const handle = fakeHandle()
    const createNotification = vi.fn(() => handle)
    const result = showNativeNotification(
      { title: 'New message', body: 'Hi there' },
      { isSupported: () => true, createNotification }
    )
    expect(result).toEqual({ shown: true })
    expect(createNotification).toHaveBeenCalledWith({ title: 'New message', body: 'Hi there' })
    expect(handle.show).toHaveBeenCalledOnce()
  })

  it('wires the click handler to onClicked only when a target was given', () => {
    const handle = fakeHandle()
    const onClicked = vi.fn()
    showNativeNotification(
      { title: 't', body: 'b', target: { channelId: 'chan-1' } },
      { isSupported: () => true, createNotification: () => handle, onClicked }
    )
    expect(handle.on).toHaveBeenCalledWith('click', expect.any(Function))
    handle.listeners.click()
    expect(onClicked).toHaveBeenCalledWith({ channelId: 'chan-1' })
  })

  it('does not register a click listener when no target is given', () => {
    const handle = fakeHandle()
    const onClicked = vi.fn()
    showNativeNotification(
      { title: 't', body: 'b' },
      { isSupported: () => true, createNotification: () => handle, onClicked }
    )
    expect(handle.on).not.toHaveBeenCalled()
  })
})
