import { describe, expect, it } from 'vitest'
import { strokePathData, strokeViewBox } from './stroke-path'

describe('strokePathData', () => {
  it('is empty without points', () => {
    expect(strokePathData([])).toBe('')
  })
  it('draws a dot for a single point', () => {
    expect(strokePathData([[2, 3]])).toBe('M2 3 L2 3')
  })
  it('joins points with line segments', () => {
    expect(
      strokePathData([
        [0, 0],
        [5, 5],
        [10, 0]
      ])
    ).toBe('M0 0 L5 5 L10 0')
  })
})

describe('strokeViewBox', () => {
  it('fits the points with a minimum size of 1', () => {
    expect(
      strokeViewBox([
        [2, 3],
        [12, 3]
      ])
    ).toBe('2 3 10 1')
    expect(strokeViewBox([])).toBe('0 0 1 1')
  })
})
