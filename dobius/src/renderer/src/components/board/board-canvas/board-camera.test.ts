import { describe, expect, it } from 'vitest'
import {
  boardCameraEase,
  boardCameraFit,
  boardFocusMinZoom,
  boardFocusViewport,
  boardSafeArea,
  interpolateViewport
} from './board-camera'
import { BOARD_CHROME_INSETS } from './board-reveal'
import { worldToScreen } from './board-viewport'

const SCREEN = { width: 1440, height: 900 }
const CONSOLE = { x: 200, y: 100, width: 640, height: 400 }

function screenRect(rect: typeof CONSOLE, v: { x: number; y: number; zoom: number }) {
  const tl = worldToScreen({ x: rect.x, y: rect.y }, v)
  return { x: tl.x, y: tl.y, w: rect.width * v.zoom, h: rect.height * v.zoom }
}

describe('board camera', () => {
  it('safe area is the screen minus the chrome insets', () => {
    expect(boardSafeArea(SCREEN)).toEqual({ x: 96, y: 72, width: 1264, height: 658 })
  })

  it('focus fits a console inside the safe area with 32px padding', () => {
    const v = boardFocusViewport(CONSOLE, SCREEN, 14)
    const r = screenRect(CONSOLE, v)
    const i = BOARD_CHROME_INSETS
    expect(r.x).toBeGreaterThanOrEqual(i.left + 32 - 0.5)
    expect(r.y).toBeGreaterThanOrEqual(i.top + 32 - 0.5)
    expect(r.x + r.w).toBeLessThanOrEqual(SCREEN.width - i.right - 32 + 0.5)
    expect(r.y + r.h).toBeLessThanOrEqual(SCREEN.height - i.bottom - 32 + 0.5)
    // Limited by height: (658 - 64) / 400.
    expect(v.zoom).toBeCloseTo(594 / 400)
  })

  it('never focuses below 100% or below 13px terminal text', () => {
    expect(boardFocusMinZoom(14)).toBe(1)
    expect(boardFocusMinZoom(10)).toBeCloseTo(1.3)
    // A huge console on a small window still lands readable, title bar on screen.
    const big = { x: 0, y: 0, width: 2000, height: 1400 }
    const small = { width: 1000, height: 700 }
    const v = boardFocusViewport(big, small, 10)
    expect(v.zoom).toBeCloseTo(1.3)
    const r = screenRect(big, v)
    expect(r.x).toBeCloseTo(BOARD_CHROME_INSETS.left + 32)
    expect(r.y).toBeCloseTo(BOARD_CHROME_INSETS.top + 32)
  })

  it('fits groups at no more than 100%', () => {
    const v = boardCameraFit([{ x: 0, y: 0, width: 100, height: 100 }], SCREEN, { padding: 48 })
    expect(v.zoom).toBe(1)
  })

  it('interpolates from the start viewport to exactly the target (restore is exact)', () => {
    const from = { x: 10, y: -30, zoom: 0.5 }
    const to = { x: -400, y: -120, zoom: 1.5 }
    const center = { x: 720, y: 450 }
    expect(interpolateViewport(from, to, 0, center)).toEqual(from)
    expect(interpolateViewport(from, to, 1, center)).toEqual(to)
    const mid = interpolateViewport(from, to, 0.5, center)
    expect(mid.zoom).toBeCloseTo(Math.sqrt(0.5 * 1.5))
    expect(boardCameraEase(0)).toBe(0)
    expect(boardCameraEase(1)).toBe(1)
    expect(boardCameraEase(0.5)).toBeGreaterThan(0.5)
  })
})
