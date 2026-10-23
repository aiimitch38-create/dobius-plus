import { describe, expect, it } from 'vitest'
import { boundsOfBoxes, snapBoardBox } from './board-snap'

const other = { x: 100, y: 100, w: 200, h: 100 }

describe('snapBoardBox', () => {
  it('snaps left edge to a nearby left edge and reports a vertical guide', () => {
    const r = snapBoardBox({ x: 104, y: 400, w: 50, h: 50 }, [other], 6)
    expect(r.dx).toBe(-4)
    expect(r.dy).toBe(0)
    expect(r.guides).toEqual([{ axis: 'x', at: 100, from: 100, to: 450 }])
  })

  it('snaps centers and picks the closest stop', () => {
    const r = snapBoardBox({ x: 500, y: 123, w: 40, h: 50 }, [other], 6)
    expect(r.dy).toBe(2) // moving center 148 -> other center 150
  })

  it('leaves the box alone outside the threshold', () => {
    expect(snapBoardBox({ x: 120, y: 400, w: 50, h: 50 }, [other], 6)).toEqual({
      dx: 0,
      dy: 0,
      guides: []
    })
  })

  it('computes bounds of several boxes', () => {
    expect(boundsOfBoxes([other, { x: 0, y: 250, w: 10, h: 10 }])).toEqual({
      x: 0,
      y: 100,
      w: 300,
      h: 160
    })
    expect(boundsOfBoxes([])).toBeNull()
  })
})
