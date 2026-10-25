import { describe, expect, it } from 'vitest'
import {
  CURSOR_STEP_MS,
  CURSOR_TRAVEL_MAX_MS,
  CURSOR_TRAVEL_MIN_MS,
  cursorPath,
  cursorTravelDurationMs
} from './agent-cursor-path'

describe('cursor path', () => {
  it('clamps travel duration to [100, 300] ms with 80 + 0.4*d in between', () => {
    expect(cursorTravelDurationMs(0)).toBe(CURSOR_TRAVEL_MIN_MS)
    expect(cursorTravelDurationMs(10)).toBe(CURSOR_TRAVEL_MIN_MS)
    expect(cursorTravelDurationMs(300)).toBe(200)
    expect(cursorTravelDurationMs(5000)).toBe(CURSOR_TRAVEL_MAX_MS)
  })

  it('samples ~16 ms steps, ends exactly on the target, and stays monotonic in time', () => {
    const path = cursorPath({ x: 0, y: 0 }, { x: 300, y: 400 }, { seed: 7 })
    expect(path.at(-1)).toEqual({ x: 300, y: 400, at: 280 })
    expect(path.length).toBe(Math.ceil(280 / CURSOR_STEP_MS))
    for (let i = 1; i < path.length; i++) {
      expect(path[i].at).toBeGreaterThan(path[i - 1].at)
    }
  })

  it('is curved (not a straight line) and deterministic for a seed', () => {
    const a = cursorPath({ x: 0, y: 0 }, { x: 200, y: 0 }, { seed: 3 })
    const b = cursorPath({ x: 0, y: 0 }, { x: 200, y: 0 }, { seed: 3 })
    expect(a).toEqual(b)
    expect(a.some((p) => Math.abs(p.y) > 1)).toBe(true)
  })

  it('does not overshoot small targets', () => {
    const path = cursorPath({ x: 0, y: 0 }, { x: 100, y: 0 }, { seed: 1, targetSizePx: 12 })
    expect(Math.max(...path.map((p) => p.x))).toBeLessThanOrEqual(100)
  })

  it('returns a single zero-time step when already on target', () => {
    expect(cursorPath({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual([{ x: 5, y: 5, at: 0 }])
  })
})
