import { describe, expect, it } from 'vitest'
import { revealRectViewport } from './board-reveal'

const SCREEN = { w: 1400, h: 900 }
const INSETS = { left: 100, top: 70, right: 80, bottom: 170 }

describe('revealRectViewport', () => {
  it('leaves the viewport alone when the card is already visible', () => {
    const v = { x: 0, y: 0, zoom: 1 }
    expect(revealRectViewport(v, { x: 200, y: 100, w: 300, h: 300 }, SCREEN, INSETS)).toBe(v)
  })

  it('pans left just enough to show a card placed past the right edge', () => {
    const v = { x: 0, y: 0, zoom: 1 }
    const next = revealRectViewport(v, { x: 1500, y: 100, w: 360, h: 460 }, SCREEN, INSETS)
    expect(next).toEqual({ x: 1320 - 1860, y: 0, zoom: 1 })
  })

  it('accounts for zoom', () => {
    const v = { x: 0, y: 0, zoom: 0.5 }
    const next = revealRectViewport(v, { x: 0, y: 2000, w: 400, h: 400 }, SCREEN, INSETS)
    // card bottom at 1200 screen px; the visible bottom is 730.
    expect(next.y).toBe(730 - 1200)
    expect(next.x).toBe(100)
  })

  it('aligns an oversized card to the top-left of the visible area', () => {
    const v = { x: 0, y: 0, zoom: 1 }
    const next = revealRectViewport(v, { x: 500, y: 500, w: 5000, h: 5000 }, SCREEN, INSETS)
    expect(next).toEqual({ x: -400, y: -430, zoom: 1 })
  })
})
