import { describe, expect, it } from 'vitest'
import { resolveEffectiveActiveView } from './board-effective-view'

describe('resolveEffectiveActiveView', () => {
  it('falls back to the terminal view (Landing) when the Board has no workspace', () => {
    expect(resolveEffectiveActiveView('board', null)).toBe('terminal')
  })

  it('keeps the Board once a workspace is active, and leaves other views alone', () => {
    expect(resolveEffectiveActiveView('board', 'wt-1')).toBe('board')
    expect(resolveEffectiveActiveView('settings', null)).toBe('settings')
  })
})
