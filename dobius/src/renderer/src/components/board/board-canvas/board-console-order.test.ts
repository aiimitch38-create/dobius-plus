import { describe, expect, it } from 'vitest'
import { boardFocusStepOrder, boardReadingOrder, boardStepId } from './board-console-order'

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

  it('⌥←/→ order covers every card kind, skipping ink and line/arrow connectors', () => {
    const mixed = [
      { id: 'web', kind: 'web', x: 700, y: 0, w: 600, h: 400 },
      { id: 'ink', kind: 'stroke', x: 100, y: 10, w: 50, h: 50 },
      { id: 'note', kind: 'note', x: 0, y: 0, w: 240, h: 200 },
      { id: 'arrow', kind: 'shape', shape: 'arrow', x: 300, y: 20, w: 200, h: 20 },
      { id: 'box', kind: 'shape', shape: 'rect', x: 0, y: 600, w: 120, h: 80 },
      { id: 'con', kind: 'console', x: 700, y: 600, w: 640, h: 400 },
      { id: 'img', kind: 'image', x: 300, y: 620, w: 200, h: 150 }
    ]
    expect(boardFocusStepOrder(mixed).map((c) => c.id)).toEqual([
      'note',
      'web',
      'box',
      'img',
      'con'
    ])
  })
})
