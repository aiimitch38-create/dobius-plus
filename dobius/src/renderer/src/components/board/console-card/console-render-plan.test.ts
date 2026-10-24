import { describe, expect, it } from 'vitest'
import {
  consoleGridPixels,
  consoleHostBox,
  glanceScale,
  nextConsoleMode,
  shouldRefit,
  zoomedFontSize
} from './console-render-plan'

describe('nextConsoleMode', () => {
  // 14px base font on a default 640x360 console body.
  const base = {
    prev: 'live' as const,
    settledZoom: 1,
    visible: true,
    gesturing: false,
    baseFontSize: 14,
    bodyWidth: 640,
    bodyHeight: 360
  }
  it('stays live while on-screen text is readable and glances below ~6px', () => {
    expect(nextConsoleMode(base)).toBe('live')
    // 14 * 0.45 = 6.3px on screen: still live.
    expect(nextConsoleMode({ ...base, settledZoom: 0.45 })).toBe('live')
    // 14 * 0.4 = 5.6px: the glance takes over (the reported blank-white zoom range).
    expect(nextConsoleMode({ ...base, settledZoom: 0.4 })).toBe('glance')
    expect(nextConsoleMode({ ...base, settledZoom: 0.1 })).toBe('glance')
  })
  it('scales the threshold with the user font size', () => {
    expect(nextConsoleMode({ ...base, baseFontSize: 20, settledZoom: 0.35 })).toBe('live')
    expect(nextConsoleMode({ ...base, baseFontSize: 10, settledZoom: 0.55 })).toBe('glance')
  })
  it('uses hysteresis so a hovering zoom does not thrash', () => {
    // 14 * 0.46 = 6.44px: above enter (6), below exit (6.75).
    expect(nextConsoleMode({ ...base, settledZoom: 0.46 })).toBe('live')
    expect(nextConsoleMode({ ...base, prev: 'glance', settledZoom: 0.46 })).toBe('glance')
    expect(nextConsoleMode({ ...base, prev: 'glance', settledZoom: 0.5 })).toBe('live')
  })
  it('glances when the card itself is too small on screen to show a terminal', () => {
    // Readable font, but a 300x160 body at 0.6 is 180x96 screen px.
    const small = { ...base, bodyWidth: 300, bodyHeight: 160 }
    expect(nextConsoleMode({ ...small, settledZoom: 0.6 })).toBe('glance')
    expect(nextConsoleMode({ ...small, settledZoom: 1 })).toBe('live')
    // Exit needs 10% more room than enter.
    expect(nextConsoleMode({ ...small, prev: 'glance', settledZoom: 0.78 })).toBe('glance')
    expect(nextConsoleMode({ ...small, prev: 'glance', settledZoom: 0.9 })).toBe('live')
  })
  it('ignores size until the body has been measured', () => {
    expect(nextConsoleMode({ ...base, bodyWidth: 0, bodyHeight: 0, settledZoom: 0.6 })).toBe('live')
  })
  it('glances off-screen cards', () => {
    expect(nextConsoleMode({ ...base, visible: false })).toBe('glance')
  })
  it('never switches mid-gesture', () => {
    expect(nextConsoleMode({ ...base, gesturing: true, settledZoom: 0.1 })).toBe('live')
    expect(nextConsoleMode({ ...base, prev: 'glance', gesturing: true })).toBe('glance')
  })
})

describe('glanceScale', () => {
  it('counter-scales the glance to screen px but never enlarges it', () => {
    expect(glanceScale(0.25)).toBe(0.25)
    expect(glanceScale(2)).toBe(1)
    expect(glanceScale(0)).toBe(1)
  })
})

describe('zoomedFontSize', () => {
  it('scales with zoom so cols/rows stay constant, in half-point steps', () => {
    expect(zoomedFontSize(14, 1)).toBe(14)
    expect(zoomedFontSize(14, 2)).toBe(28)
    expect(zoomedFontSize(14, 0.53)).toBe(7.5)
    expect(zoomedFontSize(14, 0)).toBe(14)
  })
})

describe('consoleHostBox', () => {
  it('counter-scales only when a font override is available', () => {
    expect(consoleHostBox(400, 300, 2, true)).toEqual({ width: 800, height: 600, scale: 0.5 })
    expect(consoleHostBox(400, 300, 2, false)).toEqual({ width: 400, height: 300, scale: 1 })
    expect(consoleHostBox(400, 300, 0, true)).toEqual({ width: 400, height: 300, scale: 1 })
  })
})

describe('grid invariant', () => {
  it.each([true, false])('cols/rows do not change with zoom (fontOverride=%s)', (fontOverride) => {
    const at = (zoom: number) => consoleGridPixels(640, 400, zoom, 14, fontOverride)
    const base = at(1)
    for (const zoom of [0.4, 0.5, 0.75, 1.5, 2, 3]) {
      const grid = at(zoom)
      // Within one half-point font step of rounding.
      expect(Math.abs(grid.width - base.width) / base.width).toBeLessThan(0.04)
      expect(Math.abs(grid.height - base.height) / base.height).toBeLessThan(0.04)
    }
  })
})

describe('shouldRefit', () => {
  it('refits only live, settled, changed cards', () => {
    expect(shouldRefit({ mode: 'live', gesturing: false, changed: true })).toBe(true)
    expect(shouldRefit({ mode: 'live', gesturing: true, changed: true })).toBe(false)
    expect(shouldRefit({ mode: 'glance', gesturing: false, changed: true })).toBe(false)
    expect(shouldRefit({ mode: 'live', gesturing: false, changed: false })).toBe(false)
  })
})
