import { describe, expect, it } from 'vitest'
import { strokeCardFromWorldPoints } from './board-stroke-capture'

describe('strokeCardFromWorldPoints', () => {
  it('returns null for no points', () => {
    expect(strokeCardFromWorldPoints([])).toBeNull()
  })

  it('uses point bounds and makes points relative to the card origin', () => {
    expect(
      strokeCardFromWorldPoints([
        { x: 10, y: 20 },
        { x: 30, y: 15 },
        { x: 25, y: 40 }
      ])
    ).toEqual({
      x: 10,
      y: 15,
      w: 20,
      h: 25,
      points: [
        [0, 5],
        [20, 0],
        [15, 25]
      ]
    })
  })

  it('keeps a tap visible with a minimum extent', () => {
    expect(strokeCardFromWorldPoints([{ x: 5, y: 5 }])).toMatchObject({ w: 4, h: 4 })
  })
})
