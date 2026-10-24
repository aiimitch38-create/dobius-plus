// @vitest-environment happy-dom
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '@/store/types'
import {
  createBoardSlice,
  getBoard,
  resetBoardPersistenceForTest,
  type NewBoardCard
} from '@/store/slices/board'

const { testStore } = vi.hoisted(() => ({ testStore: { current: null as unknown } }))
vi.mock('@/store', () => ({
  useAppStore: { getState: () => (testStore.current as { getState: () => AppState }).getState() }
}))

import {
  exitBoardFocus,
  focusBoardConsole,
  stepBoardFocus,
  useBoardCameraFocus
} from './board-camera-focus'
import { BOARD_CAMERA_DURATION_MS } from './board-camera'
import { boardSafeArea } from './board-viewport'
import { installBoardScrollLock } from './board-scroll-lock'

const WT = 'wt-1'
const consoleCard = (title: string, x: number, y: number): NewBoardCard =>
  ({
    kind: 'console',
    tabId: `tab-${title}`,
    agentKind: 'claude',
    title,
    x,
    y,
    w: 640,
    h: 400
  }) as NewBoardCard

describe('board camera focus', () => {
  let store: UseBoundStore<StoreApi<AppState>>
  beforeEach(() => {
    resetBoardPersistenceForTest()
    store = create<AppState>()((...a) => ({ ...createBoardSlice(...a) }) as AppState)
    testStore.current = store
    useBoardCameraFocus.setState({ focus: null })
    // Reduced motion: the camera jumps, so the end state is observable synchronously.
    window.matchMedia = vi.fn(() => ({ matches: true }) as unknown as MediaQueryList)
    Object.assign(window, { api: { ui: { set: vi.fn(() => Promise.resolve()) } } })
  })

  it('flies to a console, raises it, and Esc restores the exact previous viewport', () => {
    const s = store.getState()
    const id = s.addCard(WT, consoleCard('A', 2000, 1500))
    s.addCard(WT, consoleCard('B', 2000, 1500))
    const before = { x: 37, y: -12, zoom: 0.42 }
    s.setViewport(WT, before)

    expect(focusBoardConsole(WT, id)).toBe(true)
    const board = getBoard(store.getState(), WT)
    expect(board.viewport.zoom).toBeGreaterThanOrEqual(1)
    const card = board.cards.find((c) => c.id === id)
    expect(card?.z).toBe(Math.max(...board.cards.map((c) => c.z)))
    expect(useBoardCameraFocus.getState().focus?.cardId).toBe(id)
    expect(useBoardCameraFocus.getState().focus?.arrivedAt).toBeGreaterThan(0)

    expect(exitBoardFocus()).toBe(true)
    expect(getBoard(store.getState(), WT).viewport).toEqual(before)
    expect(useBoardCameraFocus.getState().focus).toBeNull()
    expect(exitBoardFocus()).toBe(false)
  })

  it('stepping keeps the original viewport to return to', () => {
    const s = store.getState()
    const a = s.addCard(WT, consoleCard('A', 0, 0))
    const b = s.addCard(WT, consoleCard('B', 700, 0))
    const before = { x: 5, y: 6, zoom: 0.5 }
    s.setViewport(WT, before)
    focusBoardConsole(WT, a)
    expect(stepBoardFocus(WT, 1, null)).toBe(true)
    expect(useBoardCameraFocus.getState().focus?.cardId).toBe(b)
    expect(stepBoardFocus(WT, 1, null)).toBe(true)
    expect(useBoardCameraFocus.getState().focus?.cardId).toBe(a)
    exitBoardFocus()
    expect(getBoard(store.getState(), WT).viewport).toEqual(before)
  })

  it('centres the rendered card even when the browser had scrolled the canvas', () => {
    // Real DOM: a canvas the size of the window holding the transformed world.
    const canvas = document.createElement('div')
    canvas.setAttribute('data-board-canvas', '')
    document.body.appendChild(canvas)
    try {
      const s = store.getState()
      // A console off to the lower right of a zoomed-out, panned overview.
      const id = s.addCard(WT, { ...consoleCard('A', 1800, 1400), w: 560, h: 340 } as NewBoardCard)
      s.setViewport(WT, { x: -310, y: 120, zoom: 0.35 })
      // The terminal took focus mid-flight and the browser revealed its textarea
      // by scrolling the (overflow:hidden) canvas. This offset is what pushed the
      // focused console to the top-left corner in the installed build.
      canvas.scrollLeft = 420
      canvas.scrollTop = 260

      focusBoardConsole(WT, id)

      const { viewport, cards } = getBoard(store.getState(), WT)
      const card = cards.find((c) => c.id === id)!
      // Where the card actually renders: model transform minus the canvas scroll.
      const renderedCenter = {
        x: (card.x + card.w / 2) * viewport.zoom + viewport.x - canvas.scrollLeft,
        y: (card.y + card.h / 2) * viewport.zoom + viewport.y - canvas.scrollTop
      }
      const safe = boardSafeArea({ width: window.innerWidth, height: window.innerHeight })
      expect(renderedCenter.x).toBeCloseTo(safe.x + safe.width / 2, 5)
      expect(renderedCenter.y).toBeCloseTo(safe.y + safe.height / 2, 5)
      // Fully visible inside the safe area.
      const left = card.x * viewport.zoom + viewport.x - canvas.scrollLeft
      const top = card.y * viewport.zoom + viewport.y - canvas.scrollTop
      expect(left).toBeGreaterThanOrEqual(safe.x)
      expect(top).toBeGreaterThanOrEqual(safe.y)
      expect(left + card.w * viewport.zoom).toBeLessThanOrEqual(safe.x + safe.width)
      expect(top + card.h * viewport.zoom).toBeLessThanOrEqual(safe.y + safe.height)
    } finally {
      canvas.remove()
    }
  })

  it('the scroll lock undoes a browser reveal-scroll of the canvas as it happens', () => {
    const root = document.createElement('div')
    root.setAttribute('data-board-scroll-lock', '')
    const canvas = document.createElement('div')
    canvas.setAttribute('data-board-canvas', '')
    const xtermViewport = document.createElement('div')
    root.appendChild(canvas)
    canvas.appendChild(xtermViewport)
    document.body.appendChild(root)
    const uninstall = installBoardScrollLock(root)
    try {
      canvas.scrollTop = 300
      canvas.dispatchEvent(new Event('scroll'))
      expect(canvas.scrollTop).toBe(0)
      // A terminal's own scrollback is not a Board container and keeps scrolling.
      xtermViewport.scrollTop = 120
      xtermViewport.dispatchEvent(new Event('scroll'))
      expect(xtermViewport.scrollTop).toBe(120)
    } finally {
      uninstall()
      root.remove()
    }
  })

  it('ignores cards that are not on the board', () => {
    expect(focusBoardConsole(WT, 'missing')).toBe(false)
    expect(useBoardCameraFocus.getState().focus).toBeNull()
    expect(BOARD_CAMERA_DURATION_MS).toBe(280)
  })
})
