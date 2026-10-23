import { describe, expect, it } from 'vitest'
import { boardToolForKey, boardToolPansOnEmptyDrag } from './board-tools'

const bare = { metaKey: false, ctrlKey: false, altKey: false }

describe('board tool keys', () => {
  it('maps v/t/p/e to tools, case-insensitive', () => {
    expect(boardToolForKey({ ...bare, key: 'v' })).toBe('select')
    expect(boardToolForKey({ ...bare, key: 'T' })).toBe('spawn')
    expect(boardToolForKey({ ...bare, key: 'p' })).toBe('pen')
    expect(boardToolForKey({ ...bare, key: 'e' })).toBe('eraser')
    expect(boardToolForKey({ ...bare, key: 'x' })).toBeNull()
  })

  it('ignores keys with modifiers so Cmd+V paste never switches tools', () => {
    expect(boardToolForKey({ ...bare, key: 'v', metaKey: true })).toBeNull()
    expect(boardToolForKey({ ...bare, key: 'v', ctrlKey: true })).toBeNull()
    expect(boardToolForKey({ ...bare, key: 'e', altKey: true })).toBeNull()
  })

  it('pans on empty drag only with the select tool', () => {
    expect(boardToolPansOnEmptyDrag('select')).toBe(true)
    expect(boardToolPansOnEmptyDrag('pen')).toBe(false)
  })
})
