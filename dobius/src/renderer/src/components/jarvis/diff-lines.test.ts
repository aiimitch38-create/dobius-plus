import { describe, expect, it } from 'vitest'
import { collapseContext, diffLines } from './diff-lines'

describe('diffLines', () => {
  it('marks an added line', () => {
    expect(diffLines('a\nb', 'a\nx\nb')).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'added', text: 'x' },
      { kind: 'context', text: 'b' }
    ])
  })

  it('marks a removed line', () => {
    expect(diffLines('a\nb\nc', 'a\nc')).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'context', text: 'c' }
    ])
  })

  it('marks a replacement as a removal plus an addition', () => {
    const result = diffLines('one', 'two')
    expect(result.map((line) => line.kind).sort()).toEqual(['added', 'removed'])
  })

  it('returns only context when nothing changed', () => {
    expect(diffLines('a\nb', 'a\nb').every((line) => line.kind === 'context')).toBe(true)
  })
})

describe('collapseContext', () => {
  it('elides long unchanged runs but keeps lines around a change', () => {
    const before = Array.from({ length: 30 }, (_, index) => `line ${index}`).join('\n')
    const after = before.replace('line 15', 'line 15 changed')
    const collapsed = collapseContext(diffLines(before, after), 2)

    expect(collapsed.length).toBeLessThan(20)
    expect(collapsed.some((line) => line.text === '⋯')).toBe(true)
    expect(collapsed.some((line) => line.kind === 'added')).toBe(true)
  })
})
