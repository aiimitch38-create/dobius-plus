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

  it('ignores cards that are not on the board', () => {
    expect(focusBoardConsole(WT, 'missing')).toBe(false)
    expect(useBoardCameraFocus.getState().focus).toBeNull()
    expect(BOARD_CAMERA_DURATION_MS).toBe(280)
  })
})
