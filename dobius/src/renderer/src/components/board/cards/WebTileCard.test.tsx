// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'

const { toastWarningMock } = vi.hoisted(() => ({ toastWarningMock: vi.fn() }))
vi.mock('sonner', () => ({ toast: { warning: toastWarningMock } }))
import { getBoard, type BoardCardOf } from '@/store/slices/board'
import { WebTileCard } from './WebTileCard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

class NoopObserver {
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
}

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('ResizeObserver', NoopObserver)
  vi.stubGlobal('IntersectionObserver', NoopObserver)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const card = {
  id: 'web-1',
  kind: 'web',
  title: 'Site',
  url: 'https://example.com/',
  x: 0,
  y: 0,
  w: 640,
  h: 400,
  z: 1
} as BoardCardOf<'web'>

function render(zoom: number): void {
  act(() => root.render(<WebTileCard card={card} onChange={() => {}} zoom={zoom} />))
}

describe('WebTileCard zoomed out', () => {
  it('lays a glance over the page but keeps the same webview mounted', async () => {
    render(1)
    const webview = container.querySelector('webview')
    expect(webview).not.toBeNull()
    expect(container.querySelector('[data-board-card-glance]')).toBeNull()
    const capturePage = vi.fn(async () => ({
      isEmpty: () => false,
      getSize: () => ({ width: 640, height: 360 }),
      resize: () => {
        throw new Error('not needed')
      },
      toDataURL: () => 'data:image/png;base64,AAAA'
    }))
    Object.assign(webview as object, { capturePage })

    render(0.1)
    // Mid-gesture: still the live page.
    expect(container.querySelector('[data-board-card-glance]')).toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    const glance = container.querySelector('[data-board-card-glance]')
    expect(glance).not.toBeNull()
    expect(container.querySelector('webview')).toBe(webview)
    expect(capturePage).toHaveBeenCalled()
    expect(glance?.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA')
    expect(glance?.getAttribute('tabindex')).toBeNull()

    render(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(container.querySelector('[data-board-card-glance]')).toBeNull()
    expect(container.querySelector('webview')).toBe(webview)
  })

  it('starts as a glance when the board opens zoomed out, without a thumbnail yet', () => {
    render(0.2)
    const glance = container.querySelector('[data-board-card-glance]')
    expect(glance).not.toBeNull()
    expect(glance?.querySelector('img')).toBeNull()
    expect(container.querySelector('webview')).not.toBeNull()
  })
})

describe('WebTileCard sessions and popups', () => {
  type PopupListener = (event: { guestWebContentsId: number; url: string; disposition: string }) => void
  let popupListener: PopupListener | null
  let registerGuest: ReturnType<typeof vi.fn>
  let unregisterGuest: ReturnType<typeof vi.fn>
  const WT = 'wt-popups'

  beforeEach(() => {
    popupListener = null
    registerGuest = vi.fn(async () => undefined)
    unregisterGuest = vi.fn(async () => undefined)
    vi.stubGlobal('api', {
      ui: {
        onBoardWebTilePopup: (listener: PopupListener) => {
          popupListener = listener
          return () => {
            popupListener = null
          }
        }
      },
      browser: { registerGuest, unregisterGuest }
    })
    Object.assign(window, { api: (globalThis as { api?: unknown }).api })
    useAppStore.setState((s) => {
      const next = { ...s.boardsByWorktree }
      delete next[WT]
      return { boardsByWorktree: next }
    })
  })

  function mountOnBoard(session?: 'incognito' | 'shared'): BoardCardOf<'web'> {
    const id = useAppStore
      .getState()
      .addCard(WT, { ...card, ...(session ? { session } : {}), id: undefined } as never)
    const live = getBoard(useAppStore.getState(), WT).cards.find((c) => c.id === id)
    if (!live || live.kind !== 'web') {
      throw new Error('card missing')
    }
    act(() => root.render(<WebTileCard card={live} onChange={() => {}} worktreeId={WT} zoom={1} />))
    return live
  }

  function fakeAttach(webContentsId: number, zoomFactor = 1): ReturnType<typeof vi.fn> {
    const webview = container.querySelector('webview')
    if (!webview) {
      throw new Error('no webview')
    }
    const setZoomFactor = vi.fn()
    Object.assign(webview, {
      getWebContentsId: () => webContentsId,
      getZoomFactor: () => zoomFactor,
      setZoomFactor
    })
    act(() => {
      webview.dispatchEvent(new Event('did-attach'))
      webview.dispatchEvent(new Event('dom-ready'))
    })
    return setZoomFactor
  }

  it('browses in the private in-memory partition unless the card opted into the signed-in one', () => {
    mountOnBoard()
    expect(container.querySelector('webview')?.getAttribute('partition')).toBe('dobius-web-tile')
    act(() => root.unmount())
    root = createRoot(container)
    mountOnBoard('shared')
    expect(container.querySelector('webview')?.getAttribute('partition')).toBe(
      'persist:dobius-browser'
    )
  })

  it('pins the guest zoom factor to 1 only for the private session, and only when it drifted', () => {
    expect(mountOnBoard() && fakeAttach(51, 1.25)).toHaveBeenCalledWith(1)
    act(() => root.unmount())
    root = createRoot(container)
    expect(mountOnBoard() && fakeAttach(52, 1)).not.toHaveBeenCalled()
    act(() => root.unmount())
    root = createRoot(container)
    expect(mountOnBoard('shared') && fakeAttach(53, 1.25)).not.toHaveBeenCalled()
  })

  it('registers its guest as web-tile:<cardId> on did-attach and unregisters on unmount', () => {
    const live = mountOnBoard()
    fakeAttach(41)
    expect(registerGuest).toHaveBeenCalledWith({
      browserPageId: `web-tile:${live.id}`,
      workspaceId: `web-tile:${live.id}`,
      worktreeId: WT,
      webContentsId: 41
    })
    act(() => root.unmount())
    root = createRoot(container)
    expect(unregisterGuest).toHaveBeenCalledWith({ browserPageId: `web-tile:${live.id}` })
  })

  it('a popup event for this guest adds exactly one sibling web tile beside it', () => {
    const live = mountOnBoard()
    fakeAttach(42)
    expect(popupListener).not.toBeNull()
    act(() => {
      popupListener?.({ guestWebContentsId: 99, url: 'https://other.example/', disposition: 'new-window' })
    })
    expect(getBoard(useAppStore.getState(), WT).cards).toHaveLength(1)
    act(() => {
      popupListener?.({ guestWebContentsId: 42, url: 'https://example.com/login', disposition: 'new-window' })
    })
    const cards = getBoard(useAppStore.getState(), WT).cards
    expect(cards).toHaveLength(2)
    const sibling = cards.find((c) => c.id !== live.id)
    expect(sibling).toMatchObject({
      kind: 'web',
      url: 'https://example.com/login',
      w: live.w,
      h: live.h,
      x: live.x + live.w + 32,
      y: live.y
    })
    expect(sibling && 'session' in sibling ? sibling.session : undefined).toBeUndefined()
    expect(sibling && 'popupOf' in sibling ? sibling.popupOf : undefined).toBe(live.id)
  })

  it('refuses a sixth popup-derived sibling for one source tile, with a toast', () => {
    toastWarningMock.mockReset()
    mountOnBoard()
    fakeAttach(43)
    for (let i = 0; i < 7; i += 1) {
      act(() => {
        popupListener?.({ guestWebContentsId: 43, url: `https://example.com/${i}`, disposition: 'new-window' })
      })
    }
    // Source + 5 siblings; the 6th and 7th were refused.
    expect(getBoard(useAppStore.getState(), WT).cards).toHaveLength(6)
    expect(toastWarningMock).toHaveBeenCalledTimes(2)
  })
})
