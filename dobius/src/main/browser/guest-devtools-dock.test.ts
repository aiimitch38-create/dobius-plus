import { beforeEach, describe, expect, it, vi } from 'vitest'

type FakeContents = {
  id: number
  type: string
  hostId: number | null
  destroyed: boolean
  devToolsOpen: boolean
  isDestroyed: () => boolean
  getType: () => string
  hostWebContents: { id: number } | null
  isDevToolsOpened: ReturnType<typeof vi.fn>
  closeDevTools: ReturnType<typeof vi.fn>
  setDevToolsWebContents: ReturnType<typeof vi.fn>
  openDevTools: ReturnType<typeof vi.fn>
}

const registry = new Map<number, FakeContents>()

vi.mock('electron', () => ({
  webContents: { fromId: (id: number) => registry.get(id) }
}))

const { dockGuestDevTools } = await import('./guest-devtools-dock')

function add(id: number, type: string, hostId: number | null): FakeContents {
  const contents: FakeContents = {
    id,
    type,
    hostId,
    destroyed: false,
    devToolsOpen: false,
    isDestroyed: () => contents.destroyed,
    getType: () => contents.type,
    hostWebContents: hostId === null ? null : { id: hostId },
    isDevToolsOpened: vi.fn(() => contents.devToolsOpen),
    closeDevTools: vi.fn(() => {
      contents.devToolsOpen = false
    }),
    setDevToolsWebContents: vi.fn(),
    openDevTools: vi.fn(() => {
      contents.devToolsOpen = true
    })
  }
  registry.set(id, contents)
  return contents
}

const sender = { id: 1 } as never

describe('dockGuestDevTools', () => {
  beforeEach(() => registry.clear())

  it('docks a guest into a second webview owned by the same window', () => {
    const guest = add(10, 'webview', 1)
    const host = add(11, 'webview', 1)
    expect(dockGuestDevTools(sender, { guestWebContentsId: 10, devToolsWebContentsId: 11 })).toBe(
      true
    )
    expect(guest.setDevToolsWebContents).toHaveBeenCalledWith(host)
    expect(guest.openDevTools).toHaveBeenCalled()
  })

  it('closes already-open (detached) DevTools before re-targeting', () => {
    const guest = add(10, 'webview', 1)
    add(11, 'webview', 1)
    guest.devToolsOpen = true
    dockGuestDevTools(sender, { guestWebContentsId: 10, devToolsWebContentsId: 11 })
    expect(guest.closeDevTools).toHaveBeenCalled()
    expect(guest.closeDevTools.mock.invocationCallOrder[0]).toBeLessThan(
      guest.setDevToolsWebContents.mock.invocationCallOrder[0]
    )
  })

  it('refuses guests embedded by another window', () => {
    add(10, 'webview', 2)
    add(11, 'webview', 1)
    expect(dockGuestDevTools(sender, { guestWebContentsId: 10, devToolsWebContentsId: 11 })).toBe(
      false
    )
  })

  it('refuses non-webview targets, missing ids, and self-docking', () => {
    const guest = add(10, 'webview', 1)
    add(12, 'window', null)
    expect(dockGuestDevTools(sender, { guestWebContentsId: 10, devToolsWebContentsId: 12 })).toBe(
      false
    )
    expect(dockGuestDevTools(sender, { guestWebContentsId: 10, devToolsWebContentsId: 99 })).toBe(
      false
    )
    expect(dockGuestDevTools(sender, { guestWebContentsId: 10, devToolsWebContentsId: 10 })).toBe(
      false
    )
    expect(guest.setDevToolsWebContents).not.toHaveBeenCalled()
  })

  it('reports failure when Electron throws so the caller can detach instead', () => {
    const guest = add(10, 'webview', 1)
    add(11, 'webview', 1)
    guest.setDevToolsWebContents.mockImplementation(() => {
      throw new Error('already navigated')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(dockGuestDevTools(sender, { guestWebContentsId: 10, devToolsWebContentsId: 11 })).toBe(
      false
    )
    warn.mockRestore()
  })
})
