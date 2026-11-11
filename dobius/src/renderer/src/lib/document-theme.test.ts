import { describe, expect, it } from 'vitest'
import {
  applyDocumentTheme,
  isDaytime,
  resolveAppearance,
  resolveDocumentTheme,
  THEME_TRANSITION_DISABLED_CLASS
} from './document-theme'

class FakeClassList {
  private readonly tokens = new Set<string>()

  add(...tokens: string[]): void {
    for (const token of tokens) {
      this.tokens.add(token)
    }
  }

  remove(...tokens: string[]): void {
    for (const token of tokens) {
      this.tokens.delete(token)
    }
  }

  toggle(token: string, force?: boolean): boolean {
    if (force === true) {
      this.tokens.add(token)
      return true
    }
    if (force === false) {
      this.tokens.delete(token)
      return false
    }
    if (this.tokens.has(token)) {
      this.tokens.delete(token)
      return false
    }
    this.tokens.add(token)
    return true
  }

  contains(token: string): boolean {
    return this.tokens.has(token)
  }
}

function createThemeRoot(): {
  classList: FakeClassList
  attributes: Map<string, string>
  setAttribute: (name: string, value: string) => void
  removeAttribute: (name: string) => void
} {
  const attributes = new Map<string, string>()
  return {
    classList: new FakeClassList(),
    attributes,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name)
  }
}

function createFrameQueue(): {
  requestAnimationFrame: (callback: FrameRequestCallback) => number
  cancelAnimationFrame: (handle: number) => void
  flushNextFrame: () => void
  pendingCount: () => number
} {
  let nextHandle = 1
  const callbacks = new Map<number, FrameRequestCallback>()
  return {
    requestAnimationFrame: (callback) => {
      const handle = nextHandle++
      callbacks.set(handle, callback)
      return handle
    },
    cancelAnimationFrame: (handle) => {
      callbacks.delete(handle)
    },
    flushNextFrame: () => {
      const [handle, callback] = callbacks.entries().next().value ?? []
      if (handle === undefined || !callback) {
        return
      }
      callbacks.delete(handle)
      callback(0)
    },
    pendingCount: () => callbacks.size
  }
}

const NOON = new Date(2026, 0, 1, 12, 0, 0)
const MIDNIGHT = new Date(2026, 0, 1, 0, 0, 0)
const JUST_AFTER_DAY_START = new Date(2026, 0, 1, 7, 0, 0)
const JUST_BEFORE_DAY_START = new Date(2026, 0, 1, 6, 59, 0)
const JUST_BEFORE_DAY_END = new Date(2026, 0, 1, 18, 59, 0)
const JUST_AFTER_DAY_END = new Date(2026, 0, 1, 19, 0, 0)

describe('isDaytime', () => {
  it('is daytime between 7am (inclusive) and 7pm (exclusive)', () => {
    expect(isDaytime(NOON)).toBe(true)
    expect(isDaytime(JUST_AFTER_DAY_START)).toBe(true)
    expect(isDaytime(JUST_BEFORE_DAY_END)).toBe(true)
  })

  it('is nighttime outside that window', () => {
    expect(isDaytime(MIDNIGHT)).toBe(false)
    expect(isDaytime(JUST_BEFORE_DAY_START)).toBe(false)
    expect(isDaytime(JUST_AFTER_DAY_END)).toBe(false)
  })
})

describe('resolveAppearance', () => {
  it('resolves explicit theme preferences regardless of time', () => {
    expect(resolveAppearance('dark', NOON)).toBe('dark')
    expect(resolveAppearance('dark', MIDNIGHT)).toBe('dark')
    expect(resolveAppearance('neon', NOON)).toBe('neon')
    expect(resolveAppearance('neon', MIDNIGHT)).toBe('neon')
  })

  it('resolves system by time of day: day -> light, night -> dark', () => {
    expect(resolveAppearance('system', NOON)).toBe('light')
    expect(resolveAppearance('system', MIDNIGHT)).toBe('dark')
  })

  it('never resolves system to neon', () => {
    expect(resolveAppearance('system', NOON)).not.toBe('neon')
    expect(resolveAppearance('system', MIDNIGHT)).not.toBe('neon')
  })
})

describe('resolveDocumentTheme', () => {
  it('resolves explicit theme preferences', () => {
    expect(resolveDocumentTheme('dark')).toBe(true)
    expect(resolveDocumentTheme('neon')).toBe(true)
  })

  it('resolves system from the clock', () => {
    expect(resolveDocumentTheme('system', NOON)).toBe(false)
    expect(resolveDocumentTheme('system', MIDNIGHT)).toBe(true)
  })
})

describe('applyDocumentTheme', () => {
  it('applies dark and neon root classes/attributes', () => {
    const root = createThemeRoot()

    applyDocumentTheme('dark', { root, disableTransitions: false })
    expect(root.classList.contains('dark')).toBe(true)
    expect(root.attributes.has('data-appearance')).toBe(false)

    applyDocumentTheme('neon', { root, disableTransitions: false })
    expect(root.classList.contains('dark')).toBe(true)
    expect(root.attributes.get('data-appearance')).toBe('neon')

    applyDocumentTheme('dark', { root, disableTransitions: false })
    expect(root.attributes.has('data-appearance')).toBe(false)
  })

  it('applies system root class from the clock, re-evaluating live', () => {
    const root = createThemeRoot()

    applyDocumentTheme('system', { root, now: NOON, disableTransitions: false })
    expect(root.classList.contains('dark')).toBe(false)

    applyDocumentTheme('system', { root, now: MIDNIGHT, disableTransitions: false })
    expect(root.classList.contains('dark')).toBe(true)
  })

  it('removes the transition suppression class after two animation frames', () => {
    const root = createThemeRoot()
    const frames = createFrameQueue()

    applyDocumentTheme('dark', {
      root,
      requestAnimationFrame: frames.requestAnimationFrame,
      cancelAnimationFrame: frames.cancelAnimationFrame
    })

    expect(root.classList.contains(THEME_TRANSITION_DISABLED_CLASS)).toBe(true)

    frames.flushNextFrame()
    expect(root.classList.contains(THEME_TRANSITION_DISABLED_CLASS)).toBe(true)

    frames.flushNextFrame()
    expect(root.classList.contains(THEME_TRANSITION_DISABLED_CLASS)).toBe(false)
  })

  it('cancels stale transition suppression frames on rapid theme changes', () => {
    const root = createThemeRoot()
    const frames = createFrameQueue()

    applyDocumentTheme('dark', {
      root,
      requestAnimationFrame: frames.requestAnimationFrame,
      cancelAnimationFrame: frames.cancelAnimationFrame
    })
    expect(frames.pendingCount()).toBe(1)

    applyDocumentTheme('neon', {
      root,
      requestAnimationFrame: frames.requestAnimationFrame,
      cancelAnimationFrame: frames.cancelAnimationFrame
    })
    expect(frames.pendingCount()).toBe(1)

    frames.flushNextFrame()
    expect(root.classList.contains(THEME_TRANSITION_DISABLED_CLASS)).toBe(true)
    expect(frames.pendingCount()).toBe(1)

    frames.flushNextFrame()
    expect(root.classList.contains(THEME_TRANSITION_DISABLED_CLASS)).toBe(false)
    expect(frames.pendingCount()).toBe(0)
  })
})
