import { describe, expect, it } from 'vitest'
import {
  boardFreeSpawnCenter,
  boardSpawnBlockSize,
  boardSpawnPlacements
} from './board-spawn-placement'

const size = { w: 100, h: 50 }

describe('boardSpawnPlacements', () => {
  it('centers a single console on the point', () => {
    expect(boardSpawnPlacements({ x: 0, y: 0 }, 1, size)).toEqual([{ x: -50, y: -25 }])
  })

  it('lays four consoles out as a centered 2x2 grid', () => {
    expect(boardSpawnPlacements({ x: 0, y: 0 }, 4, size)).toEqual([
      { x: -116, y: -66 },
      { x: 16, y: -66 },
      { x: -116, y: 16 },
      { x: 16, y: 16 }
    ])
  })

  it('returns nothing for zero or negative counts', () => {
    expect(boardSpawnPlacements({ x: 0, y: 0 }, 0, size)).toEqual([])
    expect(boardSpawnPlacements({ x: 0, y: 0 }, -2, size)).toEqual([])
  })
})

describe('boardFreeSpawnCenter', () => {
  const visible = { x: 0, y: 0, w: 1000, h: 600 }
  const block = { w: 300, h: 200 }

  it('uses the top-left of the visible area when it is empty', () => {
    expect(boardFreeSpawnCenter(visible, block, [])).toEqual({ x: 150, y: 100 })
  })

  it('skips past a card occupying the first slot', () => {
    const c = boardFreeSpawnCenter(visible, block, [{ x: 0, y: 0, w: 300, h: 200 }])
    const placed = { x: c.x - 150, y: c.y - 100, w: 300, h: 200 }
    expect(placed.x >= 324 || placed.y >= 224).toBe(true)
    expect(placed.x + placed.w).toBeLessThanOrEqual(1000)
    expect(placed.y + placed.h).toBeLessThanOrEqual(600)
  })

  it('falls back to the right of the rightmost card when the view is full', () => {
    const full = [{ x: -50, y: -50, w: 1100, h: 700 }]
    expect(boardFreeSpawnCenter(visible, block, full).x).toBeGreaterThan(1050)
  })

  it('sizes the block for 1 and 4 consoles', () => {
    expect(boardSpawnBlockSize(1, { w: 100, h: 50 })).toEqual({ w: 100, h: 50 })
    expect(boardSpawnBlockSize(4, { w: 100, h: 50 })).toEqual({ w: 232, h: 132 })
  })
})
