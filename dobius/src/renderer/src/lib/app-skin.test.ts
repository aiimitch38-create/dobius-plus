import { describe, expect, it } from 'vitest'

import { APP_SKIN_BUZZ, APP_SKIN_NAMES, APP_SKIN_NONE, applyAppSkin } from './app-skin'

class FakeStyle {
  readonly props = new Map<string, string>()
  setProperty(key: string, value: string): void {
    this.props.set(key, value)
  }
  removeProperty(key: string): void {
    this.props.delete(key)
  }
}

class FakeClassList {
  readonly tokens = new Set<string>()
  toggle(token: string, force?: boolean): boolean {
    const on = force ?? !this.tokens.has(token)
    if (on) {
      this.tokens.add(token)
    } else {
      this.tokens.delete(token)
    }
    return on
  }
}

class FakeRoot {
  readonly style = new FakeStyle()
  readonly classList = new FakeClassList()
  readonly attributes = new Map<string, string>()
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }
}

function fakeRoot(): FakeRoot {
  return new FakeRoot()
}

describe('applyAppSkin', () => {
  it('sets tokens and dark class for a dark skin', () => {
    const root = fakeRoot()
    applyAppSkin('Midnight', root as unknown as HTMLElement)
    expect(root.style.props.get('--background')).toBe('#0D1117')
    expect(root.style.props.get('--foreground')).toBe('#E6EDF3')
    expect(root.classList.tokens.has('dark')).toBe(true)
    expect(root.classList.tokens.has('light')).toBe(false)
  })

  it('marks a light-background skin as light', () => {
    const root = fakeRoot()
    applyAppSkin('Butter', root as unknown as HTMLElement)
    expect(root.classList.tokens.has('light')).toBe(true)
    expect(root.classList.tokens.has('dark')).toBe(false)
  })

  it('clears all skin tokens for none / unknown', () => {
    const root = fakeRoot()
    applyAppSkin('Midnight', root as unknown as HTMLElement)
    expect(root.style.props.size).toBeGreaterThan(0)
    applyAppSkin(APP_SKIN_NONE, root as unknown as HTMLElement)
    expect(root.style.props.size).toBe(0)
  })

  it('sets the buzz attribute without inline tokens and leaves theme classes alone', () => {
    const root = fakeRoot()
    applyAppSkin('Midnight', root as unknown as HTMLElement)
    applyAppSkin(APP_SKIN_BUZZ, root as unknown as HTMLElement)
    expect(root.attributes.has('data-buzz-skin')).toBe(true)
    expect(root.style.props.size).toBe(0)
    // Buzz has light+dark stylesheet variants; the theme effect owns the class.
    expect(root.classList.tokens.has('dark')).toBe(true)
  })

  it('removes the buzz attribute when switching away', () => {
    const root = fakeRoot()
    applyAppSkin(APP_SKIN_BUZZ, root as unknown as HTMLElement)
    applyAppSkin(APP_SKIN_NONE, root as unknown as HTMLElement)
    expect(root.attributes.has('data-buzz-skin')).toBe(false)
  })

  it('exposes the 18 legacy skin names', () => {
    expect(APP_SKIN_NAMES).toHaveLength(18)
    expect(APP_SKIN_NAMES).toContain('Midnight')
    expect(APP_SKIN_NAMES).toContain('Peach')
  })
})
