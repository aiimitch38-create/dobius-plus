import { describe, expect, it } from 'vitest'
import { presetMetaLine } from './preset-meta'

describe('presetMetaLine', () => {
  it('pluralizes consoles and groups independently', () => {
    expect(presetMetaLine(1, 1)).toBe('1 console · 1 group')
    expect(presetMetaLine(4, 1)).toBe('4 consoles · 1 group')
    expect(presetMetaLine(1, 3)).toBe('1 console · 3 groups')
    expect(presetMetaLine(0, 0)).toBe('0 consoles · 0 groups')
  })
})
