import { describe, expect, it } from 'vitest'
import { LOD_MIN_MINIATURE_PX, miniatureWorthDrawing, nextBoardLod } from './board-lod'

describe('nextBoardLod', () => {
  // A 16px-text web page on a 640x400 body.
  const base = {
    prev: 'full' as const,
    settledZoom: 1,
    visible: true,
    gesturing: false,
    textPx: 16,
    bodyWidth: 640,
    bodyHeight: 400
  }

  it('stays full while text is readable on screen and glances below ~6px', () => {
    expect(nextBoardLod(base)).toBe('full')
    // 16 * 0.4 = 6.4px: still readable.
    expect(nextBoardLod({ ...base, settledZoom: 0.4 })).toBe('full')
    // 16 * 0.35 = 5.6px.
    expect(nextBoardLod({ ...base, settledZoom: 0.35 })).toBe('glance')
    expect(nextBoardLod({ ...base, settledZoom: 0.1 })).toBe('glance')
  })

  it('uses hysteresis: returning to full needs ~6.75px', () => {
    // 16 * 0.4 = 6.4px sits between enter (6) and exit (6.75).
    expect(nextBoardLod({ ...base, prev: 'glance', settledZoom: 0.4 })).toBe('glance')
    expect(nextBoardLod({ ...base, prev: 'glance', settledZoom: 0.43 })).toBe('full')
  })

  it('applies an optional minimum on-screen body, with 10% exit headroom', () => {
    const minBody = { w: 220, h: 120 }
    expect(nextBoardLod({ ...base, bodyHeight: 160, minBody, settledZoom: 0.7 })).toBe('glance')
    expect(nextBoardLod({ ...base, bodyHeight: 160, minBody, settledZoom: 0.8 })).toBe('full')
    expect(
      nextBoardLod({ ...base, prev: 'glance', bodyHeight: 160, minBody, settledZoom: 0.8 })
    ).toBe('glance')
    // Without a minimum, size never forces a glance.
    expect(nextBoardLod({ ...base, bodyHeight: 160, settledZoom: 0.7 })).toBe('full')
    // Unmeasured bodies ignore the minimum.
    expect(nextBoardLod({ ...base, bodyWidth: 0, bodyHeight: 0, minBody, settledZoom: 0.5 })).toBe(
      'full'
    )
  })

  it('glances off-screen cards and never switches mid-gesture', () => {
    expect(nextBoardLod({ ...base, visible: false })).toBe('glance')
    expect(nextBoardLod({ ...base, gesturing: true, settledZoom: 0.1 })).toBe('full')
    expect(nextBoardLod({ ...base, prev: 'glance', gesturing: true, settledZoom: 1 })).toBe(
      'glance'
    )
  })

  it('treats a missing zoom as 1', () => {
    expect(nextBoardLod({ ...base, settledZoom: 0 })).toBe('full')
  })
})

describe('miniatureWorthDrawing', () => {
  it('draws until the body is under ~60px tall on screen', () => {
    expect(miniatureWorthDrawing(400, 0.2)).toBe(true) // 80px
    expect(miniatureWorthDrawing(400, 0.1)).toBe(false) // 40px
    expect(miniatureWorthDrawing(LOD_MIN_MINIATURE_PX, 1)).toBe(true)
    expect(miniatureWorthDrawing(0, 0.05)).toBe(true)
  })
})
