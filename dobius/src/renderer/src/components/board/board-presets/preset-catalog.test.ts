import { describe, expect, it } from 'vitest'
import { isTuiAgent } from '../../../../../shared/tui-agent-config'
import { presetCatalog, presetConsoleCount } from './preset-catalog'

const SWATCHES = new Set(['yellow', 'pink', 'blue', 'green', 'purple', 'accent'])

describe('presetCatalog', () => {
  const catalog = presetCatalog()

  it('ships 18 built-in layouts with unique ids', () => {
    expect(catalog).toHaveLength(18)
    expect(new Set(catalog.map((p) => p.id)).size).toBe(catalog.length)
  })

  it('has 12 role-based workspace layouts and 6 plain sizes', () => {
    expect(catalog.filter((p) => p.section === 'workspace')).toHaveLength(12)
    expect(catalog.filter((p) => p.section === 'plain')).toHaveLength(6)
  })

  it.each(catalog.map((p) => [p.id, p] as const))('%s is well formed', (_id, preset) => {
    expect(preset.name.trim()).not.toBe('')
    expect(preset.description.trim()).not.toBe('')
    expect(preset.lanes.length).toBeGreaterThan(0)
    expect(presetConsoleCount(preset)).toBeLessThanOrEqual(16)
    expect(new Set(preset.lanes.map((l) => l.id)).size).toBe(preset.lanes.length)
    for (const lane of preset.lanes) {
      expect(lane.count).toBeGreaterThan(0)
      expect(SWATCHES.has(lane.color)).toBe(true)
      expect(lane.agent === 'shell' || isTuiAgent(lane.agent)).toBe(true)
    }
    const kinds = preset.extras.map((e) => e.kind)
    expect(new Set(kinds).size).toBe(kinds.length)
  })
})
