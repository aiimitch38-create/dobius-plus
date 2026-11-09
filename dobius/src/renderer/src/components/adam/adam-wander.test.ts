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

  it('can reach anywhere in the viewport, including far corners', () => {
    // Carson wants Adam free to roam the whole app, not fenced into a
    // corner — a pinned-high rng should be able to reach the far edge.
    const target = pickAdamWanderTarget(SIZE, VIEWPORT, () => 1)
    expect(target.x).toBe(VIEWPORT.width - SIZE)
    expect(target.y).toBe(VIEWPORT.height - SIZE)
  })

  it('still spends most of its time biased toward the top-left on average', () => {
    // The min-of-two-uniforms trick skews the distribution low without
    // capping its range — average over many draws should sit well under
    // the viewport midpoint even though any single draw can reach the edge.
    let sumX = 0
    let sumY = 0
    const samples = 400
    for (let i = 0; i < samples; i++) {
      const target = pickAdamWanderTarget(SIZE, VIEWPORT, Math.random)
      sumX += target.x
      sumY += target.y
    }
    expect(sumX / samples).toBeLessThan((VIEWPORT.width - SIZE) * 0.5)
    expect(sumY / samples).toBeLessThan((VIEWPORT.height - SIZE) * 0.5)
  })

  it('is deterministic for a fixed rng', () => {
    const a = pickAdamWanderTarget(SIZE, VIEWPORT, () => 0.25)
    const b = pickAdamWanderTarget(SIZE, VIEWPORT, () => 0.25)
    expect(a).toEqual(b)
  })
})
