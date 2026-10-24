import { describe, expect, it } from 'vitest'
import { duplicateCardDraft, duplicateSpot, nextConsoleTitle } from './board-duplicate-spot'

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

describe('duplicateCardDraft', () => {
  it('places a plain copy beside the source, not 24px on top of it, and names it a copy', () => {
    const web = {
      id: 'w1',
      z: 3,
      kind: 'web',
      url: 'x',
      title: 'Web tile',
      x: 0,
      y: 0,
      w: 900,
      h: 600
    }
    const draft = duplicateCardDraft(web as never, [web])
    expect(draft).toMatchObject({ kind: 'web', url: 'x', x: 932, y: 0, w: 900, h: 600 })
    expect(draft.title).toBe('Web tile copy')
    expect('id' in draft).toBe(false)
    expect('z' in draft).toBe(false)
  })
})
