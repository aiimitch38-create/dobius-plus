import { describe, expect, it } from 'vitest'
import { boardReadingOrder, boardStepId } from './board-console-order'

const card = (id: string, x: number, y: number) => ({ id, x, y, w: 640, h: 400 })

describe('console reading order', () => {
  it('reads left to right, then top to bottom, tolerating small misalignment', () => {
    const cards = [card('d', 700, 450), card('b', 700, 12), card('c', 0, 440), card('a', 0, 0)]
    expect(boardReadingOrder(cards).map((c) => c.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('steps with wrap-around and starts at an end when nothing is current', () => {
    const ids = ['a', 'b', 'c']
    expect(boardStepId(ids, 'a', 1)).toBe('b')
    expect(boardStepId(ids, 'c', 1)).toBe('a')
    expect(boardStepId(ids, 'a', -1)).toBe('c')
    expect(boardStepId(ids, null, 1)).toBe('a')
    expect(boardStepId(ids, null, -1)).toBe('c')
    expect(boardStepId(ids, 'gone', 1)).toBe('a')
    expect(boardStepId([], 'a', 1)).toBeNull()
  })
})
