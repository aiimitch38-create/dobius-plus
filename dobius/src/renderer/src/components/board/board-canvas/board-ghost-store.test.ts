// @vitest-environment happy-dom
// Why: prefersReducedMotion reads window.matchMedia, which only exists with a DOM.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BOARD_GHOST_MS,
  boardGhostOf,
  pushBoardGhosts,
  setBoardGhostPreview,
  useBoardGhosts
} from './board-ghost-store'

const rect = { x: 10, y: 20, w: 640, h: 400 }

function stubReducedMotion(matches: boolean): void {
  vi.stubGlobal('matchMedia', () => ({ matches }) as MediaQueryList)
}

describe('board ghost store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    stubReducedMotion(false)
    useBoardGhosts.setState({ ghosts: [], preview: [] })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('holds a spawn ghost for BOARD_GHOST_MS, then empties itself', () => {
    pushBoardGhosts([{ ...rect, kind: 'console', agent: 'claude', cardId: 'c1' }])
    const [ghost] = useBoardGhosts.getState().ghosts
    expect(ghost).toMatchObject({ ...rect, kind: 'console', agent: 'claude', cardId: 'c1' })

    vi.advanceTimersByTime(BOARD_GHOST_MS - 1)
    expect(useBoardGhosts.getState().ghosts).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(useBoardGhosts.getState().ghosts).toEqual([])
  })

  it('expires each push on its own clock', () => {
    pushBoardGhosts([{ ...rect, kind: 'web' }])
    vi.advanceTimersByTime(200)
    pushBoardGhosts([{ ...rect, y: 900, kind: 'web' }])
    vi.advanceTimersByTime(BOARD_GHOST_MS - 200)
    expect(useBoardGhosts.getState().ghosts.map((g) => g.y)).toEqual([900])
    vi.advanceTimersByTime(200)
    expect(useBoardGhosts.getState().ghosts).toEqual([])
  })

  it('skips spawn ghosts under prefers-reduced-motion (the card simply appears)', () => {
    stubReducedMotion(true)
    pushBoardGhosts([{ ...rect, kind: 'console' }])
    expect(useBoardGhosts.getState().ghosts).toEqual([])
    // The hover preview is not motion: it still shows.
    setBoardGhostPreview([{ ...rect, kind: 'web' }])
    expect(useBoardGhosts.getState().preview).toHaveLength(1)
  })

  it('does not publish a new empty preview when it is already empty', () => {
    const before = useBoardGhosts.getState().preview
    setBoardGhostPreview([])
    expect(useBoardGhosts.getState().preview).toBe(before)
  })

  it('boardGhostOf keeps the rect and kind, and only a real TUI agent', () => {
    expect(
      boardGhostOf({ ...rect, kind: 'console', agentKind: 'claude', title: 'x' } as never, 'id1')
    ).toEqual({ ...rect, kind: 'console', agent: 'claude', cardId: 'id1' })
    expect(boardGhostOf({ ...rect, kind: 'console', agentKind: 'shell' }).agent).toBeUndefined()
    expect(boardGhostOf({ ...rect, kind: 'web' })).toEqual({
      ...rect,
      kind: 'web',
      agent: undefined,
      cardId: undefined
    })
  })
})
