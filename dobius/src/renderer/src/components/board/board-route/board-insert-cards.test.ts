import { describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n/i18n', () => ({ translate: (_k: string, fallback: string) => fallback }))
vi.mock('../board-tool-panels/board-tool-style-store', () => ({
  getBoardToolStyle: () => ({ shape: 'rect', style: { fill: 'blue' } })
}))

const { boardDraggedShapeRect, SHAPE_MIN_SIDE } = await import('./board-insert-cards')

describe('boardDraggedShapeRect (draw a shape by dragging)', () => {
  it('uses the dragged rectangle, not the 160x120 default', () => {
    expect(boardDraggedShapeRect({ x: 100, y: 50 }, { x: 420, y: 290 }, 1)).toEqual({
      x: 100,
      y: 50,
      w: 320,
      h: 240
    })
  })

  it('normalises drags up and to the left', () => {
    expect(boardDraggedShapeRect({ x: 400, y: 300 }, { x: 100, y: 120 }, 0.5)).toEqual({
      x: 100,
      y: 120,
      w: 300,
      h: 180
    })
  })

  it('treats a barely moved press as a click (null: default size)', () => {
    expect(boardDraggedShapeRect({ x: 10, y: 10 }, { x: 12, y: 11 }, 1)).toBeNull()
    // 3 world px at 50% is 1.5px on screen: still a click.
    expect(boardDraggedShapeRect({ x: 10, y: 10 }, { x: 13, y: 10 }, 0.5)).toBeNull()
  })

  it('never makes a sliver: each side is at least the minimum', () => {
    const rect = boardDraggedShapeRect({ x: 0, y: 0 }, { x: 200, y: 3 }, 1)
    expect(rect).toEqual({ x: 0, y: 0, w: 200, h: SHAPE_MIN_SIDE })
  })
})
