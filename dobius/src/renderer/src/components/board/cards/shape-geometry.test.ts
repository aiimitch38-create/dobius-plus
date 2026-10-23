import { describe, expect, it } from 'vitest'
import { arrowHeadPath, shapeGeometry, shapeSeed } from './shape-geometry'

const coords = (d: string): number[] => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)

describe('shapeGeometry', () => {
  it('architect (0 wobble) gives straight, inset paths', () => {
    expect(shapeGeometry('rect', 100, 50, 4, 0, 1).d).toBe(
      'M2.00 2.00 L98.00 2.00 L98.00 48.00 L2.00 48.00 Z'
    )
  })

  it('keeps every point inside the card even when sloppy', () => {
    for (const shape of ['rect', 'ellipse', 'diamond', 'triangle', 'line', 'arrow'] as const) {
      const g = shapeGeometry(shape, 200, 120, 5, 3, 42)
      const nums = coords(g.d)
      for (let i = 0; i < nums.length; i += 2) {
        expect(nums[i]).toBeGreaterThanOrEqual(0)
        expect(nums[i]).toBeLessThanOrEqual(200)
        expect(nums[i + 1]).toBeGreaterThanOrEqual(0)
        expect(nums[i + 1]).toBeLessThanOrEqual(120)
      }
    }
  })

  it('is deterministic per seed and differs between seeds', () => {
    expect(shapeGeometry('rect', 100, 100, 3, 3, 7).d).toBe(
      shapeGeometry('rect', 100, 100, 3, 3, 7).d
    )
    expect(shapeGeometry('rect', 100, 100, 3, 3, 7).d).not.toBe(
      shapeGeometry('rect', 100, 100, 3, 3, 8).d
    )
  })

  it('only arrows get a head; lines are open paths', () => {
    expect(shapeGeometry('line', 100, 100, 3, 0, 1)).toMatchObject({
      closed: false,
      arrowHead: null
    })
    expect(shapeGeometry('arrow', 100, 100, 3, 0, 1).arrowHead).not.toBeNull()
  })

  it('arrow head ends exactly on the tip', () => {
    expect(arrowHeadPath([0, 0], [100, 0], 2)).toContain('L100.00 0.00')
  })

  it('seeds are stable positive numbers', () => {
    expect(shapeSeed('abc')).toBe(shapeSeed('abc'))
    expect(shapeSeed('abc')).toBeGreaterThan(0)
  })
})

describe('line direction', () => {
  it('cycles clockwise and points the line at that corner', async () => {
    const { lineEnds, nextLineDirection, shapeGeometry } = await import('./shape-geometry')
    expect(nextLineDirection(undefined)).toBe('sw')
    expect(nextLineDirection('ne')).toBe('se')
    expect(lineEnds('ne', 0, 0, 10, 10)).toEqual([
      [0, 10],
      [10, 0]
    ])
    const se = shapeGeometry('arrow', 100, 100, 2, 0, 1).d
    const nw = shapeGeometry('arrow', 100, 100, 2, 0, 1, 'nw').d
    expect(se).not.toBe(nw)
    expect(se.startsWith('M1.00 1.00')).toBe(true)
    expect(nw.startsWith('M99.00 99.00')).toBe(true)
  })
})
