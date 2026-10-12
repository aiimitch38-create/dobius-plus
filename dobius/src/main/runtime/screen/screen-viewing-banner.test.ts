import type { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ show: true, rejectLoad: false, windows: [] as unknown[] }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class Window extends EventEmitter {
    destroyed = false
    visible = false
    webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler: vi.fn() })
    html = ''
    constructor(readonly options: Record<string, unknown>) {
      super()
      state.windows.push(this)
    }
    setMenu() {}
    setVisibleOnAllWorkspaces() {}
    setAlwaysOnTop() {}
    async loadURL(url: string) {
      this.html = decodeURIComponent(url.split(',')[1])
      if (state.rejectLoad) {
        throw new Error('load failed')
      }
    }
    showInactive() {
      this.visible = state.show
    }
    isVisible() {
      return this.visible
    }
    isDestroyed() {
      return this.destroyed
    }
    destroy() {
      this.destroyed = true
      this.visible = false
      this.emit('closed')
    }
  }
  return {
    BrowserWindow: Window,
    screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1440 } }) }
  }
})
import { showScreenViewingBanner } from './screen-viewing-banner'

beforeEach(() => {
  state.show = true
  state.rejectLoad = false
  state.windows = []
})
const window = () =>
  state.windows[0] as EventEmitter & {
    destroyed: boolean
    visible: boolean
    html: string
    options: Record<string, unknown>
    webContents: EventEmitter
  }
describe('local viewing indicator visibility', () => {
  it('uses one sandboxed draggable corner indicator and the authorized no-thumbnail fallback', async () => {
    const stop = vi.fn()
    const hide = await showScreenViewingBanner('<Phone>', stop, new AbortController().signal)
    expect(state.windows).toHaveLength(1)
    expect(window().options).toMatchObject({
      width: 240,
      height: 44,
      x: 1184,
      y: 16,
      frame: false,
      alwaysOnTop: true,
      webPreferences: { sandbox: true, nodeIntegration: false }
    })
    expect(window().html).toContain('-webkit-app-region:drag')
    expect(window().html).toContain('-webkit-app-region:no-drag')
    expect(window().html).toContain('&lt;Phone&gt;')
    expect(window().html).toContain('🔴')
    expect(window().html).not.toContain('<img')
    const event = { preventDefault: vi.fn() }
    window().webContents.emit('will-navigate', event, 'dobius-screen-stop://local')
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(stop).toHaveBeenCalledOnce()
    hide()
    expect(window().destroyed).toBe(true)
  })

  it('fails closed when loading succeeds but the window does not show', async () => {
    state.show = false
    await expect(
      showScreenViewingBanner('Phone', vi.fn(), new AbortController().signal)
    ).rejects.toMatchObject({ code: 'screen_not_authorized' })
    expect(window().destroyed).toBe(true)
  })
  it('destroys a failed load', async () => {
    state.rejectLoad = true
    await expect(
      showScreenViewingBanner('Phone', vi.fn(), new AbortController().signal)
    ).rejects.toThrow()
    expect(window().destroyed).toBe(true)
  })
  it('shows before returning and destroys on session cancellation', async () => {
    const abort = new AbortController()
    const stop = vi.fn()
    await showScreenViewingBanner('Phone', stop, abort.signal)
    expect(window().visible).toBe(true)
    window().emit('hide')
    expect(stop).toHaveBeenCalledOnce()
    abort.abort()
    expect(window().destroyed).toBe(true)
  })
})
