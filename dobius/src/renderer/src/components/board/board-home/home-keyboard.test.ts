import { describe, expect, it } from 'vitest'
import { moveHomeSelection, reconcileHomeSelection, resolveHomeKey } from './home-keyboard'

const key = (
  k: string,
  mods: Partial<Record<'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey', boolean>> = {}
) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...mods
})

describe('resolveHomeKey', () => {
  it('maps plain arrows and Enter', () => {
    expect(resolveHomeKey(key('ArrowUp'), true)).toBe('up')
    expect(resolveHomeKey(key('ArrowDown'), false)).toBe('down')
    expect(resolveHomeKey(key('Enter'), true)).toBe('open')
    expect(resolveHomeKey(key('Enter', { shiftKey: true }), true)).toBeNull()
    expect(resolveHomeKey(key('a'), true)).toBeNull()
  })

  it('uses Cmd on Mac and Ctrl elsewhere', () => {
    expect(resolveHomeKey(key('o', { metaKey: true }), true)).toBe('openFolder')
    expect(resolveHomeKey(key('o', { ctrlKey: true }), true)).toBeNull()
    expect(resolveHomeKey(key('o', { ctrlKey: true }), false)).toBe('openFolder')
    expect(resolveHomeKey(key('o', { metaKey: true }), false)).toBeNull()
    expect(resolveHomeKey(key('L', { metaKey: true, shiftKey: true }), true)).toBe('switch')
    expect(resolveHomeKey(key('l', { ctrlKey: true, shiftKey: true }), false)).toBe('switch')
  })

  it('rejects extra or missing modifiers', () => {
    expect(resolveHomeKey(key('l', { metaKey: true }), true)).toBeNull()
    expect(resolveHomeKey(key('o', { metaKey: true, shiftKey: true }), true)).toBeNull()
    expect(resolveHomeKey(key('o', { metaKey: true, altKey: true }), true)).toBeNull()
    expect(resolveHomeKey(key('ArrowDown', { metaKey: true }), true)).toBeNull()
  })
})

describe('moveHomeSelection', () => {
  it('clamps without wrapping', () => {
    expect(moveHomeSelection(0, -1, 3)).toBe(0)
    expect(moveHomeSelection(2, 1, 3)).toBe(2)
    expect(moveHomeSelection(1, 1, 3)).toBe(2)
  })
  it('enters an unselected list from the matching end', () => {
    expect(moveHomeSelection(-1, 1, 3)).toBe(0)
    expect(moveHomeSelection(-1, -1, 3)).toBe(2)
  })
  it('returns -1 for an empty list', () => {
    expect(moveHomeSelection(0, 1, 0)).toBe(-1)
  })
})

describe('reconcileHomeSelection', () => {
  it('keeps the picked repo when present, else the first row', () => {
    expect(reconcileHomeSelection('b', ['a', 'b'])).toBe('b')
    expect(reconcileHomeSelection('z', ['a', 'b'])).toBe('a')
    expect(reconcileHomeSelection(null, ['a'])).toBe('a')
    expect(reconcileHomeSelection('a', [])).toBeNull()
  })
})
