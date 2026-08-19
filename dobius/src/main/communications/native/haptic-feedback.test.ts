import { describe, expect, it } from 'vitest'
import { performSidebarDefaultHaptic } from './haptic-feedback'

describe('performSidebarDefaultHaptic', () => {
  it('reports honestly that no physical feedback was produced', () => {
    expect(performSidebarDefaultHaptic()).toEqual({
      performed: false,
      reason: 'not_supported_by_electron'
    })
  })
})
