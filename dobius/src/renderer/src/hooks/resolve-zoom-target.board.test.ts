import { describe, expect, it } from 'vitest'
import { resolveZoomTarget } from './resolve-zoom-target'

describe('resolveZoomTarget on the Board', () => {
  it('routes menu zoom to the board canvas', () => {
    expect(
      resolveZoomTarget({ activeView: 'board', activeTabType: 'terminal', activeElement: null })
    ).toBe('board')
  })

  it('leaves classic terminal zoom unchanged', () => {
    expect(
      resolveZoomTarget({ activeView: 'settings', activeTabType: 'terminal', activeElement: null })
    ).toBe('ui')
  })
})
