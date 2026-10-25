import { describe, expect, it } from 'vitest'
import { clampToEdge, guestToScreen } from './agent-cursor-mapping'

// A 800x600 guest viewport; the webview's screen rect is the guest size times the Board zoom.
const GUEST_WIDTH = 800

function rectAtZoom(zoom: number): { left: number; top: number; width: number; height: number } {
  return { left: 100, top: 50, width: GUEST_WIDTH * zoom, height: 600 * zoom }
}

describe('guestToScreen', () => {
  it.each([
    [0.5, { x: 100 + 200 * 0.5, y: 50 + 100 * 0.5, w: 40 * 0.5, h: 20 * 0.5 }],
    [1, { x: 300, y: 150, w: 40, h: 20 }],
    [2, { x: 100 + 400, y: 50 + 200, w: 80, h: 40 }]
  ])('maps guest px through the tile rect at zoom %s', (zoom, expected) => {
    expect(guestToScreen({ x: 200, y: 100, w: 40, h: 20 }, rectAtZoom(zoom), GUEST_WIDTH)).toEqual(
      expected
    )
  })

  it('falls back to 1:1 when the webview has no layout width yet', () => {
    expect(guestToScreen({ x: 5, y: 6 }, { left: 0, top: 0, width: 0, height: 0 }, 0)).toEqual({
      x: 5,
      y: 6,
      w: 0,
      h: 0
    })
  })
})

describe('clampToEdge', () => {
  const bounds = { left: 0, top: 0, width: 1000, height: 500 }

  it('leaves an on-screen point alone', () => {
    expect(clampToEdge({ x: 400, y: 200 }, bounds)).toEqual({
      x: 400,
      y: 200,
      angleDeg: 0,
      offscreen: false
    })
  })

  it('clamps an off-screen point to the inset edge and points toward it', () => {
    const hint = clampToEdge({ x: 1400, y: 200 }, bounds, 16)
    expect(hint).toMatchObject({ x: 984, y: 200, offscreen: true })
    expect(hint.angleDeg).toBeCloseTo(0)
    expect(clampToEdge({ x: 400, y: -300 }, bounds, 16).angleDeg).toBeCloseTo(-90)
  })
})
