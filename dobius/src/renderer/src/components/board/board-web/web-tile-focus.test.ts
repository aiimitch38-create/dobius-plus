import { describe, expect, it } from 'vitest'
import { webTileFullyVisible } from './web-tile-focus'

const SCREEN = { width: 1440, height: 900 }
const TILE = { x: 100, y: 100, w: 640, h: 400 }

describe('webTileFullyVisible (no camera move for a tile the user can already see)', () => {
  it('is true for a tile wholly on screen at 100%', () => {
    expect(webTileFullyVisible(TILE, { x: 0, y: 0, zoom: 1 }, SCREEN)).toBe(true)
  })

  it('is false when any edge is off screen', () => {
    expect(webTileFullyVisible(TILE, { x: -200, y: 0, zoom: 1 }, SCREEN)).toBe(false)
    expect(webTileFullyVisible(TILE, { x: 900, y: 0, zoom: 1 }, SCREEN)).toBe(false)
    expect(webTileFullyVisible(TILE, { x: 0, y: 500, zoom: 1 }, SCREEN)).toBe(false)
  })

  it('is false when the zoom is below the readable floor, even if it fits', () => {
    expect(webTileFullyVisible(TILE, { x: 0, y: 0, zoom: 0.5 }, SCREEN)).toBe(false)
    expect(webTileFullyVisible(TILE, { x: 0, y: 0, zoom: 0.75 }, SCREEN)).toBe(true)
  })
})
