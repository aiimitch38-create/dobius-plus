import { describe, expect, it } from 'vitest'
import {
  BOARD_MAX_ZOOM,
  BOARD_MIN_ZOOM,
  boundsOfRects,
  clampZoom,
  dotGridSpacing,
  fitBoardViewport,
  fitViewportToRects,
  panViewport,
  screenToWorld,
  wheelDeltaToZoomFactor,
  worldToScreen,
  zoomViewportAtPoint,
  zoomViewportBy
} from './board-viewport'

describe('board viewport math', () => {
  it('clamps zoom to the shared store limits and survives non-finite input', () => {
    expect(clampZoom(0.01)).toBe(BOARD_MIN_ZOOM)
    expect(clampZoom(BOARD_MAX_ZOOM * 10)).toBe(BOARD_MAX_ZOOM)
    expect(clampZoom(1.5)).toBe(1.5)
    expect(clampZoom(Number.NaN)).toBe(1)
  })

  it('round-trips screen <-> world', () => {
    const viewport = { x: 120, y: -40, zoom: 1.75 }
    const world = screenToWorld({ x: 300, y: 200 }, viewport)
    const screen = worldToScreen(world, viewport)
    expect(screen.x).toBeCloseTo(300)
    expect(screen.y).toBeCloseTo(200)
  })

  it('pans by screen delta', () => {
    expect(panViewport({ x: 10, y: 10, zoom: 2 }, 5, -3)).toEqual({ x: 15, y: 7, zoom: 2 })
  })

  it('keeps the world point under the anchor fixed when zooming', () => {
    const viewport = { x: 50, y: 80, zoom: 1 }
    const anchor = { x: 400, y: 300 }
    const before = screenToWorld(anchor, viewport)
    const next = zoomViewportAtPoint(viewport, 2.5, anchor)
    const after = screenToWorld(anchor, next)
    expect(next.zoom).toBe(2.5)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
  })

  it('clamps zoomViewportBy and still anchors at the clamp', () => {
    const start = BOARD_MAX_ZOOM * 0.9
    const next = zoomViewportBy({ x: 0, y: 0, zoom: start }, 2, { x: 100, y: 100 })
    expect(next.zoom).toBe(BOARD_MAX_ZOOM)
    expect(screenToWorld({ x: 100, y: 100 }, next).x).toBeCloseTo(100 / start)
  })

  it('maps wheel delta to a symmetric zoom factor', () => {
    expect(wheelDeltaToZoomFactor(0)).toBe(1)
    expect(wheelDeltaToZoomFactor(-20) * wheelDeltaToZoomFactor(20)).toBeCloseTo(1)
    expect(wheelDeltaToZoomFactor(-20)).toBeGreaterThan(1)
  })

  it('computes bounds of rects', () => {
    expect(boundsOfRects([])).toBeNull()
    expect(
      boundsOfRects([
        { x: 0, y: 0, width: 100, height: 50 },
        { x: -20, y: 30, width: 40, height: 100 }
      ])
    ).toEqual({ x: -20, y: 0, width: 120, height: 130 })
  })

  it('fits content centered without zooming past 100%', () => {
    const size = { width: 1000, height: 800 }
    const small = fitViewportToRects([{ x: 0, y: 0, width: 100, height: 100 }], size, 50)
    expect(small.zoom).toBe(1)
    expect(worldToScreen({ x: 50, y: 50 }, small)).toEqual({ x: 500, y: 400 })

    const big = fitViewportToRects([{ x: 0, y: 0, width: 4000, height: 1000 }], size, 50)
    expect(big.zoom).toBeCloseTo(900 / 4000)
    const center = worldToScreen({ x: 2000, y: 500 }, big)
    expect(center.x).toBeCloseTo(500)
    expect(center.y).toBeCloseTo(400)
  })

  it('fits an empty board to world origin at center', () => {
    expect(fitViewportToRects([], { width: 800, height: 600 })).toEqual({ x: 400, y: 300, zoom: 1 })
  })

  it('keeps dot spacing between 45 and 90 px at every zoom', () => {
    for (const zoom of [BOARD_MIN_ZOOM, 0.25, 0.5, 1, 1.7, BOARD_MAX_ZOOM]) {
      const spacing = dotGridSpacing(zoom)
      expect(spacing).toBeGreaterThanOrEqual(45)
      expect(spacing).toBeLessThanOrEqual(90)
    }
    expect(dotGridSpacing(1)).toBe(90)
    expect(dotGridSpacing(0.63)).toBeCloseTo(56.7)
  })

  it('fits into the band above the command bar', () => {
    const v = fitBoardViewport([{ x: 0, y: 0, width: 100, height: 100 }], {
      width: 1000,
      height: 859
    })
    // band is 64..689 (859 - 64 - 170 = 625 tall); content centered at y = 64 + 312.5
    expect(worldToScreen({ x: 50, y: 50 }, v).y).toBeCloseTo(376.5)
    expect(worldToScreen({ x: 50, y: 50 }, v).x).toBeCloseTo(500)
  })
})
