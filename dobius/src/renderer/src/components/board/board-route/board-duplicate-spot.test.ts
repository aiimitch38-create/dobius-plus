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
