import { describe, expect, it } from 'vitest'
import { pickJarvisTargetWindow } from './jarvis-target-window'

const win = (destroyed = false): { isDestroyed: () => boolean } => ({ isDestroyed: () => destroyed })

describe('pickJarvisTargetWindow', () => {
  it('prefers the focused window', () => {
    const focused = win()
    expect(pickJarvisTargetWindow(focused, [win(), focused])).toBe(focused)
  })

  it('falls back to the first live window when nothing is focused', () => {
    const first = win()
    expect(pickJarvisTargetWindow(null, [first, win()])).toBe(first)
  })

  it('skips destroyed windows', () => {
    const live = win()
    expect(pickJarvisTargetWindow(win(true), [win(true), live])).toBe(live)
  })

  it('returns null when there is nothing to target', () => {
    expect(pickJarvisTargetWindow(null, [])).toBeNull()
  })
})
