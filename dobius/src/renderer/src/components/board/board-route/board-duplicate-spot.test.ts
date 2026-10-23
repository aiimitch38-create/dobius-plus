import { describe, expect, it } from 'vitest'
import { duplicateSpot, nextConsoleTitle } from './board-duplicate-spot'

const SOURCE = { x: 0, y: 0, w: 640, h: 400 }

describe('duplicateSpot', () => {
  it('lands directly right of the source at the same size', () => {
    expect(duplicateSpot(SOURCE, [SOURCE])).toEqual({ x: 672, y: 0 })
  })
  it('skips an occupied spot instead of covering it', () => {
    const neighbour = { x: 672, y: 0, w: 640, h: 400 }
    const spot = duplicateSpot(SOURCE, [SOURCE, neighbour])
    const overlaps = (a: typeof SOURCE, b: typeof SOURCE): boolean =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
    const copy = { ...spot, w: 640, h: 400 }
    expect(overlaps(copy, SOURCE)).toBe(false)
    expect(overlaps(copy, neighbour)).toBe(false)
  })
  it('goes directly below when the right slot is taken (QA: copy landed far right)', () => {
    const codex = { x: 672, y: 0, w: 640, h: 400 }
    const orchestrator = { x: 1344, y: -100, w: 360, h: 460 }
    expect(duplicateSpot(SOURCE, [SOURCE, codex, orchestrator])).toEqual({ x: 0, y: 432 })
  })
  it('then tries the left slot', () => {
    const right = { x: 672, y: 0, w: 640, h: 400 }
    const below = { x: 0, y: 432, w: 640, h: 400 }
    expect(duplicateSpot(SOURCE, [SOURCE, right, below])).toEqual({ x: -672, y: 0 })
  })
  it('stays close to the source when all four neighbours are taken', () => {
    const ring = [
      { x: 672, y: 0, w: 640, h: 400 },
      { x: 0, y: 432, w: 640, h: 400 },
      { x: -672, y: 0, w: 640, h: 400 },
      { x: 0, y: -432, w: 640, h: 400 }
    ]
    const spot = duplicateSpot(SOURCE, [SOURCE, ...ring])
    expect(Math.hypot(spot.x, spot.y)).toBeLessThan(1400)
    const copy = { ...spot, w: 640, h: 400 }
    const overlaps = (a: typeof SOURCE, b: typeof SOURCE): boolean =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
    for (const box of [SOURCE, ...ring]) {
      expect(overlaps(copy, box)).toBe(false)
    }
  })
  it('keeps a custom source size', () => {
    const small = { x: 100, y: 100, w: 300, h: 200 }
    expect(duplicateSpot(small, [small])).toEqual({ x: 432, y: 100 })
  })
})

describe('nextConsoleTitle', () => {
  it('picks the first free number', () => {
    expect(nextConsoleTitle('Claude', [])).toBe('Claude 1')
    expect(nextConsoleTitle('Claude', ['Claude 1', 'claude 3'])).toBe('Claude 2')
  })
})
