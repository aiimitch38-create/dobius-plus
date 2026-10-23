import { describe, expect, it } from 'vitest'
import { pickMirroredTabs } from './board-mirrored-tabs'

describe('pickMirroredTabs', () => {
  const tabs = [
    { id: 'old', launchAgent: 'claude' },
    { id: 'n1', launchAgent: 'claude' },
    { id: 'n2', launchAgent: 'codex' },
    { id: 'n3' },
    { id: 'n4', launchAgent: 'claude' }
  ]

  it('takes new, unclaimed tabs of the launched agent in order', () => {
    expect(pickMirroredTabs(tabs, new Set(['old']), new Set(), 'claude', 2)).toEqual(['n1', 'n3'])
  })

  it('skips tabs already bound to a card and respects the count', () => {
    expect(pickMirroredTabs(tabs, new Set(['old']), new Set(['n1']), 'claude', 5)).toEqual([
      'n3',
      'n4'
    ])
    expect(pickMirroredTabs(tabs, new Set(), new Set(), 'claude', 0)).toEqual([])
  })
})
