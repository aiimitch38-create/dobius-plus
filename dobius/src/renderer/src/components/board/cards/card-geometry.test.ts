import { describe, expect, it } from 'vitest'
import {
  boundsOf,
  clampRectIntoArea,
  handleCursor,
  RESIZE_HANDLE_MAX_INSET,
  RESIZE_HANDLES,
  resizeHandleBox,
  resizeRect,
  screenDeltaToWorld
} from './card-geometry'

const start = { x: 100, y: 100, w: 300, h: 200 }
const min = { w: 140, h: 80 }

describe('screenDeltaToWorld', () => {
  it('divides by zoom', () => {
    expect(screenDeltaToWorld(50, -20, 2)).toEqual({ dx: 25, dy: -10 })
    expect(screenDeltaToWorld(10, 10, 0.5)).toEqual({ dx: 20, dy: 20 })
  })
  it('treats a non-positive zoom as 1', () => {
    expect(screenDeltaToWorld(10, 5, 0)).toEqual({ dx: 10, dy: 5 })
  })
})

describe('resizeRect', () => {
  it('grows from the east and south edges without moving the origin', () => {
    expect(resizeRect(start, 'se', 40, 30, min)).toEqual({ x: 100, y: 100, w: 340, h: 230 })
  })
  it('west and north edges move the origin and keep the far edge fixed', () => {
    expect(resizeRect(start, 'nw', 20, 10, min)).toEqual({ x: 120, y: 110, w: 280, h: 190 })
  })
  it('single-axis handles leave the other axis alone', () => {
    expect(resizeRect(start, 'n', 999, 10, min)).toEqual({ x: 100, y: 110, w: 300, h: 190 })
    expect(resizeRect(start, 'e', 10, 999, min)).toEqual({ x: 100, y: 100, w: 310, h: 200 })
  })
  it('clamps to the min size while anchoring the opposite edge', () => {
    const r = resizeRect(start, 'w', 1000, 0, min)
    expect(r.w).toBe(140)
    expect(r.x + r.w).toBe(start.x + start.w)
    const s = resizeRect(start, 'ne', 0, 1000, min)
    expect(s).toEqual({ x: 100, y: 220, w: 300, h: 80 })
  })
})

describe('boundsOf', () => {
  it('returns null for no rects', () => {
    expect(boundsOf([])).toBeNull()
  })
  it('encloses all rects plus padding', () => {
    expect(
      boundsOf(
        [
          { x: 0, y: 0, w: 10, h: 10 },
          { x: 50, y: -20, w: 10, h: 10 }
        ],
        5
      )
    ).toEqual({ x: -5, y: -25, w: 70, h: 40 })
  })
})

describe('handleCursor', () => {
  it('maps handles to cursors', () => {
    expect(handleCursor('n')).toBe('ns-resize')
    expect(handleCursor('w')).toBe('ew-resize')
    expect(handleCursor('ne')).toBe('nesw-resize')
    expect(handleCursor('se')).toBe('nwse-resize')
  })
})

describe('clampRectIntoArea', () => {
  const area = { x: 0, y: 100, w: 1000, h: 600 }
  it('pulls a card whose header would sit under the top bar back into view', () => {
    expect(clampRectIntoArea({ x: 50, y: 20, w: 900, h: 600 }, area)).toEqual({
      x: 50,
      y: 100,
      w: 900,
      h: 600
    })
  })
  it('keeps right and bottom edges inside', () => {
    expect(clampRectIntoArea({ x: 900, y: 650, w: 200, h: 100 }, area)).toEqual({
      x: 800,
      y: 600,
      w: 200,
      h: 100
    })
  })
  it('anchors top-left when the card is bigger than the area', () => {
    expect(clampRectIntoArea({ x: -50, y: 0, w: 2000, h: 2000 }, area)).toEqual({
      x: 0,
      y: 100,
      w: 2000,
      h: 2000
    })
  })
  it('leaves a card that already fits alone', () => {
    const r = { x: 10, y: 200, w: 100, h: 100 }
    expect(clampRectIntoArea(r, area)).toEqual(r)
  })
})

describe('resizeHandleBox', () => {
  // The title text starts ~13 world px below the card's top edge.
  const TITLE_TEXT_TOP = 13

  it('keeps a constant 10px on-screen thickness at every zoom', () => {
    for (const zoom of [0.1, 0.23, 0.5, 1, 2.5]) {
      expect(resizeHandleBox('n', zoom).height! * zoom).toBeCloseTo(10)
      expect(resizeHandleBox('e', zoom).width! * zoom).toBeCloseTo(10)
      expect(resizeHandleBox('se', zoom).width! * zoom).toBeCloseTo(10)
    }
  })

  it('is centred on the edge at 100%, as before', () => {
    expect(resizeHandleBox('n', 1)).toEqual({ left: 8, right: 8, top: -5, height: 10 })
    expect(resizeHandleBox('nw', 1)).toEqual({ left: -5, top: -5, width: 10, height: 10 })
  })

  it('never reaches the title text, even at 23% zoom', () => {
    for (const zoom of [0.1, 0.23, 0.4]) {
      for (const handle of RESIZE_HANDLES) {
        const box = resizeHandleBox(handle, zoom)
        const thickness = (box.height ?? box.width)!
        // The edge the zone straddles is the side with the negative offset.
        const offset = Math.min(
          ...[box.top, box.bottom, box.left, box.right].filter((v) => v !== undefined)
        )
        const inward = thickness + offset
        expect(inward).toBeLessThanOrEqual(RESIZE_HANDLE_MAX_INSET + 1e-9)
      }
      const n = resizeHandleBox('n', zoom)
      expect(n.top! + n.height!).toBeLessThan(TITLE_TEXT_TOP)
    }
  })
})
