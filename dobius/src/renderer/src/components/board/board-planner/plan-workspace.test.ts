import { describe, expect, it } from 'vitest'
import { pickWorkspace } from './plan-workspace'

const list = [
  { id: 'a', name: 'main' },
  { id: 'b', name: 'Feature' },
  { id: 'c', name: 'docs' }
]

describe('pickWorkspace', () => {
  it('picks by next/previous (wrapping), position and name', () => {
    expect(pickWorkspace(list, 'c', 'next')?.id).toBe('a')
    expect(pickWorkspace(list, 'a', 'previous')?.id).toBe('c')
    expect(pickWorkspace(list, 'a', '2')?.id).toBe('b')
    expect(pickWorkspace(list, 'a', ' feature ')?.id).toBe('b')
    expect(pickWorkspace(list, 'a', 'nope')).toBeUndefined()
    expect(pickWorkspace([], 'a', 'next')).toBeUndefined()
  })
})
