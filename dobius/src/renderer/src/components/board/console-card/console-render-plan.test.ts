import { describe, expect, it } from 'vitest'
import {
  consoleGridPixels,
  consoleHostBox,
  nextConsoleMode,
  shouldRefit,
  zoomedFontSize
} from './console-render-plan'

describe('nextConsoleMode', () => {
  const base = { prev: 'live' as const, settledZoom: 1, visible: true, gesturing: false }
  it('stays live at normal zoom and snapshots when zoomed far out', () => {
    expect(nextConsoleMode(base)).toBe('live')
    expect(nextConsoleMode({ ...base, settledZoom: 0.3 })).toBe('snapshot')
  })
  it('uses hysteresis between 0.35 and 0.4', () => {
    expect(nextConsoleMode({ ...base, settledZoom: 0.37 })).toBe('live')
    expect(nextConsoleMode({ ...base, prev: 'snapshot', settledZoom: 0.37 })).toBe('snapshot')
    expect(nextConsoleMode({ ...base, prev: 'snapshot', settledZoom: 0.4 })).toBe('live')
  })
  it('snapshots off-screen cards', () => {
    expect(nextConsoleMode({ ...base, visible: false })).toBe('snapshot')
  })
  it('never switches mid-gesture', () => {
    expect(nextConsoleMode({ ...base, gesturing: true, settledZoom: 0.1 })).toBe('live')
    expect(nextConsoleMode({ ...base, prev: 'snapshot', gesturing: true })).toBe('snapshot')
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
    expect(shouldRefit({ mode: 'snapshot', gesturing: false, changed: true })).toBe(false)
    expect(shouldRefit({ mode: 'live', gesturing: false, changed: false })).toBe(false)
  })
})
