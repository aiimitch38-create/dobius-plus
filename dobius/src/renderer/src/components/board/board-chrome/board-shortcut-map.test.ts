// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { resolveBoardShortcut, type BoardShortcutEvent } from './board-shortcut-map'

const noModifiers = {
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false
}

const event = (
  key: string,
  overrides: Partial<Omit<BoardShortcutEvent, 'key'>> = {}
): BoardShortcutEvent => ({
  key,
  ...noModifiers,
  target: null,
  ...overrides
})

const modifier = (isMac: boolean) => (isMac ? { metaKey: true } : { ctrlKey: true })

describe('resolveBoardShortcut', () => {
  it('maps platform-modifier shortcuts on Mac (metaKey)', () => {
    expect(resolveBoardShortcut(event('g', modifier(true)), true)).toBe('group')
    expect(resolveBoardShortcut(event('a', modifier(true)), true)).toBe('selectAll')
    expect(resolveBoardShortcut(event('d', modifier(true)), true)).toBe('duplicate')
    expect(resolveBoardShortcut(event('0', modifier(true)), true)).toBe('resetZoom')
    expect(resolveBoardShortcut(event('z', modifier(true)), true)).toBe('undo')
  })

  it('maps platform-modifier shortcuts off Mac (ctrlKey)', () => {
    expect(resolveBoardShortcut(event('g', modifier(false)), false)).toBe('group')
    expect(resolveBoardShortcut(event('a', modifier(false)), false)).toBe('selectAll')
    expect(resolveBoardShortcut(event('d', modifier(false)), false)).toBe('duplicate')
    expect(resolveBoardShortcut(event('0', modifier(false)), false)).toBe('resetZoom')
    expect(resolveBoardShortcut(event('z', modifier(false)), false)).toBe('undo')
  })

  it('maps shift+platform-modifier z to redo on both platforms', () => {
    expect(resolveBoardShortcut(event('z', { shiftKey: true, ...modifier(true) }), true)).toBe(
      'redo'
    )
    expect(resolveBoardShortcut(event('z', { shiftKey: true, ...modifier(false) }), false)).toBe(
      'redo'
    )
  })

  it('maps bare shortcuts (no modifier) on both platforms', () => {
    for (const isMac of [true, false]) {
      expect(resolveBoardShortcut(event('l'), isMac)).toBe('openLoops')
      expect(resolveBoardShortcut(event('d'), isMac)).toBe('openDocs')
      expect(resolveBoardShortcut(event('s'), isMac)).toBe('openSkills')
      expect(resolveBoardShortcut(event('m'), isMac)).toBe('openMemory')
      expect(resolveBoardShortcut(event('x'), isMac)).toBe('openMissionMap')
      expect(resolveBoardShortcut(event('g'), isMac)).toBe('openGitHub')
    }
  })

  it('matches keys case-insensitively', () => {
    expect(resolveBoardShortcut(event('G', modifier(true)), true)).toBe('group')
    expect(resolveBoardShortcut(event('D'), false)).toBe('openDocs')
  })

  it('returns null when alt is pressed', () => {
    expect(resolveBoardShortcut(event('g', { altKey: true, ...modifier(true) }), true)).toBeNull()
    expect(resolveBoardShortcut(event('l', { altKey: true }), false)).toBeNull()
  })

  it('returns null for the wrong platform modifier', () => {
    expect(resolveBoardShortcut(event('g', { ctrlKey: true }), true)).toBeNull()
    expect(resolveBoardShortcut(event('g', { metaKey: true }), false)).toBeNull()
  })

  it('returns null for unrelated keys or unknown combinations', () => {
    expect(resolveBoardShortcut(event('q'), true)).toBeNull()
    expect(resolveBoardShortcut(event('l', modifier(false)), false)).toBeNull()
    expect(resolveBoardShortcut(event('z', { shiftKey: true }), true)).toBeNull()
  })

  it('returns null when the target is a blocked input surface', () => {
    const textarea = document.createElement('textarea')
    expect(resolveBoardShortcut(event('g', modifier(true)), true)).toBe('group')
    expect(
      resolveBoardShortcut(event('g', { ...modifier(true), target: textarea }), true)
    ).toBeNull()
    expect(resolveBoardShortcut(event('d', { target: textarea }), false)).toBeNull()
  })
})
