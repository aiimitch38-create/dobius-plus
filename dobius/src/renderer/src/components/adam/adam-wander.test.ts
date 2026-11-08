import { describe, expect, it } from 'vitest'
import { clampAdamPosition, pickAdamWanderTarget } from './adam-wander'

const VIEWPORT = { width: 1600, height: 1000 }
const SIZE = 132

describe('clampAdamPosition', () => {
  it('keeps a position fully inside the viewport', () => {
    expect(clampAdamPosition({ x: -50, y: -50 }, SIZE, VIEWPORT)).toEqual({ x: 0, y: 0 })
    expect(clampAdamPosition({ x: 99999, y: 99999 }, SIZE, VIEWPORT)).toEqual({
      x: VIEWPORT.width - SIZE,
      y: VIEWPORT.height - SIZE
    })
  })

  it('leaves an already-valid position untouched', () => {
    expect(clampAdamPosition({ x: 40, y: 80 }, SIZE, VIEWPORT)).toEqual({ x: 40, y: 80 })
  })
})

describe('pickAdamWanderTarget', () => {
  it('always lands inside the viewport', () => {
    for (let i = 0; i < 50; i++) {
      const target = pickAdamWanderTarget(SIZE, VIEWPORT, Math.random)
      expect(target.x).toBeGreaterThanOrEqual(0)
      expect(target.y).toBeGreaterThanOrEqual(0)
      expect(target.x).toBeLessThanOrEqual(VIEWPORT.width - SIZE)
      expect(target.y).toBeLessThanOrEqual(VIEWPORT.height - SIZE)
    }
  })

  it('stays biased toward the top-left, not the full viewport', () => {
    // A deterministic rng pinned at the high end should still land well
    // short of the viewport's right/bottom edge — Carson wants Adam
    // "mostly top-left," not freely roaming the whole window.
    const target = pickAdamWanderTarget(SIZE, VIEWPORT, () => 1)
    expect(target.x).toBeLessThan(VIEWPORT.width * 0.5)
    expect(target.y).toBeLessThan(VIEWPORT.height * 0.6)
  })

  it('is deterministic for a fixed rng', () => {
    const a = pickAdamWanderTarget(SIZE, VIEWPORT, () => 0.25)
    const b = pickAdamWanderTarget(SIZE, VIEWPORT, () => 0.25)
    expect(a).toEqual(b)
  })
})
