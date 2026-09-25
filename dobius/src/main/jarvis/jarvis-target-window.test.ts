import { describe, expect, it } from 'vitest'
import { pickJarvisTargetWindow } from './jarvis-target-window'

const win = (destroyed = false): { isDestroyed: () => boolean } => ({ isDestroyed: () => destroyed })

describe('pickJarvisTargetWindow', () => {
  it('prefers the focused window when it hosts the controller', () => {
    const focused = win()
    expect(pickJarvisTargetWindow(focused, [win(), focused])).toBe(focused)
  })

  it('falls back to the first live host when nothing is focused', () => {
    const first = win()
    expect(pickJarvisTargetWindow(null, [first, win()])).toBe(first)
  })

  it('skips destroyed windows', () => {
    const live = win()
    expect(pickJarvisTargetWindow(win(true), [win(true), live])).toBe(live)
  })

  it('skips a focused window that hosts no controller, e.g. self-edit (#89)', () => {
    const main = win()
    const selfEdit = win()
    expect(pickJarvisTargetWindow(selfEdit, [main])).toBe(main)
  })

  it('returns null when the only host is gone', () => {
    const selfEdit = win()
    expect(pickJarvisTargetWindow(selfEdit, [win(true)])).toBeNull()
  })

  it('returns null when there is nothing to target', () => {
    expect(pickJarvisTargetWindow(null, [])).toBeNull()
  })
})
