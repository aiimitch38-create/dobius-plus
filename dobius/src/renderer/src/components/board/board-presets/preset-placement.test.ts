import { describe, expect, it } from 'vitest'
import { presetCatalog, presetConsoleCount } from './preset-catalog'
import { PRESET_CONSOLE, placePreset, placementRects, type Rect } from './preset-placement'

const overlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

const bounds = (rects: Rect[]) => {
  const minX = Math.min(...rects.map((r) => r.x))
  const minY = Math.min(...rects.map((r) => r.y))
  const maxX = Math.max(...rects.map((r) => r.x + r.w))
  const maxY = Math.max(...rects.map((r) => r.y + r.h))
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, minY }
}

describe('placePreset', () => {
  it.each(presetCatalog().map((p) => [p.id, p] as const))(
    '%s: one rect per console, none overlap, centered',
    (_id, preset) => {
      const placement = placePreset(preset, { x: 1000, y: -500 })
      expect(placement.consoles.map((l) => l.length)).toEqual(preset.lanes.map((l) => l.count))
      const rects = placementRects(placement)
      expect(rects).toHaveLength(presetConsoleCount(preset) + preset.extras.length)
      for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) {
          expect(overlap(rects[i], rects[j])).toBe(false)
        }
      }
      const b = bounds(rects)
      expect(Math.abs(b.cx - 1000)).toBeLessThan(1)
      expect(Math.abs(b.cy + 500)).toBeLessThan(1)
    }
  )

  it('puts the orchestrator above everything and consoles at console size', () => {
    const deck = presetCatalog().find((p) => p.id === 'command-deck')!
    const placement = placePreset(deck, { x: 0, y: 0 })
    const orch = placement.extras.find((e) => e.kind === 'orchestrator')!.rect
    const below = [
      ...placement.consoles.flat(),
      ...placement.extras.filter((e) => e.kind !== 'orchestrator').map((e) => e.rect)
    ]
    expect(below.every((r) => r.y > orch.y + orch.h)).toBe(true)
    expect(
      placement.consoles.flat().every((r) => r.w === PRESET_CONSOLE.w && r.h === PRESET_CONSOLE.h)
    ).toBe(true)
  })

  it('groups of four sit in a 2 x 2 grid', () => {
    const [lane] = placePreset(
      { lanes: [{ id: 'a', name: 'A', color: 'blue', count: 4, agent: 'claude' }], extras: [] },
      { x: 0, y: 0 }
    ).consoles
    expect(new Set(lane.map((r) => r.x)).size).toBe(2)
    expect(new Set(lane.map((r) => r.y)).size).toBe(2)
  })
})
