// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardCardOf } from '@/store/slices/board'
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
