import { describe, expect, it } from 'vitest'
import {
  boardCameraEase,
  boardCameraFit,
  boardFocusCardViewport,
  boardFocusFramingFor,
  boardFocusGroupViewport,
  boardFocusMinZoom,
  boardFocusViewport,
  boardRevealBlockViewport,
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

describe('boardRevealBlockViewport (new team block)', () => {
  const safe = boardSafeArea(SCREEN)
  const inSafe = (
    r: { x: number; y: number; w: number; h: number },
    v: { x: number; y: number; zoom: number }
  ) => {
    const tl = worldToScreen({ x: r.x, y: r.y }, v)
    return (
      tl.x >= safe.x - 1e-6 &&
      tl.y >= safe.y - 1e-6 &&
      tl.x + r.w * v.zoom <= safe.x + safe.width + 1e-6 &&
      tl.y + r.h * v.zoom <= safe.y + safe.height + 1e-6
    )
  }

  it('pans a block that fits but landed under the right rail', () => {
    const v = { x: 0, y: 0, zoom: 0.5 }
    const block = { x: 2400, y: 300, w: 1312, h: 832 } // 2x2 team, off to the right
    expect(inSafe(block, v)).toBe(false)
    const next = boardRevealBlockViewport(v, block, SCREEN)
    expect(next.zoom).toBe(0.5)
    expect(inSafe(block, next)).toBe(true)
  })

  it('zooms out (never in) when the block is bigger than the safe area', () => {
    const v = { x: 0, y: 0, zoom: 1 }
    const block = { x: 2400, y: 300, w: 1312, h: 832 }
    const next = boardRevealBlockViewport(v, block, SCREEN)
    expect(next.zoom).toBeLessThan(1)
    expect(inSafe(block, next)).toBe(true)
  })

  it('leaves a visible block alone', () => {
    const v = { x: 0, y: 0, zoom: 0.5 }
    const block = { x: 300, y: 200, w: 1000, h: 600 }
    expect(boardRevealBlockViewport(v, block, SCREEN)).toBe(v)
  })

  describe('focus framing per card kind', () => {
    const inSafeArea = (rect: typeof CONSOLE, v: { x: number; y: number; zoom: number }) => {
      const r = screenRect(rect, v)
      const i = BOARD_CHROME_INSETS
      return (
        r.x >= i.left - 0.5 &&
        r.y >= i.top - 0.5 &&
        r.x + r.w <= SCREEN.width - i.right + 0.5 &&
        r.y + r.h <= SCREEN.height - i.bottom + 0.5
      )
    }

    it('classifies every kind', () => {
      expect(boardFocusFramingFor('console')).toBe('console')
      expect(boardFocusFramingFor('web')).toBe('page')
      for (const k of ['image', 'shape', 'stroke']) {
        expect(boardFocusFramingFor(k)).toBe('fit')
      }
      for (const k of [
        'note',
        'text',
        'checklist',
        'kanban',
        'calendar',
        'markdown',
        'orchestrator',
        'memory',
        'skill',
        'branches'
      ]) {
        expect(boardFocusFramingFor(k)).toBe('text')
      }
    })

    it('a console frames exactly as before', () => {
      expect(boardFocusCardViewport('console', CONSOLE, SCREEN, 14)).toEqual(
        boardFocusViewport(CONSOLE, SCREEN, 14)
      )
    })

    it('a small note fits but never zooms past 200%', () => {
      const note = { x: 10, y: 10, width: 220, height: 160 }
      const v = boardFocusCardViewport('note', note, SCREEN, 14)
      expect(v.zoom).toBe(2)
      expect(inSafeArea(note, v)).toBe(true)
    })

    it('a large text-bearing card stays readable (100%) with its title bar on screen', () => {
      const kanban = { x: 0, y: 0, width: 2400, height: 1600 }
      const v = boardFocusCardViewport('kanban', kanban, SCREEN, 14)
      expect(v.zoom).toBe(1)
      const r = screenRect(kanban, v)
      expect(r.x).toBeCloseTo(BOARD_CHROME_INSETS.left + 32)
      expect(r.y).toBeCloseTo(BOARD_CHROME_INSETS.top + 32)
    })

    it('a large image zooms out to fit whole', () => {
      const image = { x: 0, y: 0, width: 2400, height: 1600 }
      const v = boardFocusCardViewport('image', image, SCREEN, 14)
      expect(v.zoom).toBeLessThan(1)
      expect(inSafeArea(image, v)).toBe(true)
    })

    it('a web tile lands at exactly 100% with its top-left pinned, whatever its size', () => {
      for (const web of [
        { x: 300, y: 200, width: 640, height: 400 },
        { x: 0, y: 0, width: 2400, height: 1600 }
      ]) {
        const v = boardFocusCardViewport('web', web, SCREEN, 14)
        expect(v.zoom).toBe(1)
        const r = screenRect(web, v)
        expect(r.x).toBeCloseTo(BOARD_CHROME_INSETS.left + 32)
        expect(r.y).toBeCloseTo(BOARD_CHROME_INSETS.top + 32)
      }
    })

    it('a group fits its frame at no more than 100%, with 48px padding', () => {
      const frame = { x: -24, y: -24, width: 1400, height: 900 }
      const v = boardFocusGroupViewport([frame], SCREEN)
      expect(v.zoom).toBeLessThan(1)
      const r = screenRect(frame, v)
      expect(r.y).toBeGreaterThanOrEqual(BOARD_CHROME_INSETS.top + 48 - 0.5)
      expect(inSafeArea(frame, v)).toBe(true)
      expect(boardFocusGroupViewport([{ x: 0, y: 0, width: 100, height: 100 }], SCREEN).zoom).toBe(
        1
      )
    })
  })
})
