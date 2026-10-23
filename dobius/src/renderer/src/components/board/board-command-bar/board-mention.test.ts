import { describe, expect, it } from 'vitest'
import { parseBoardMention } from './board-mention'

const targets = [
  { id: 'a', name: 'Reviewer' },
  { id: 'b', name: 'Reviewer 2' },
  { id: 'c', name: 'Code reviewer' }
]

describe('parseBoardMention', () => {
  it('returns null without a leading @', () => {
    expect(parseBoardMention('Reviewer do it', targets)).toBeNull()
  })

  it('matches a target and strips separators', () => {
    expect(parseBoardMention('@reviewer: fix the tests', targets)).toEqual({
      target: targets[0],
      message: 'fix the tests'
    })
  })

  it('prefers the longest matching name', () => {
    expect(parseBoardMention('@Reviewer 2 go', targets)?.target.id).toBe('b')
  })

  it('accepts dashed spellings of multi-word names', () => {
    expect(parseBoardMention('@code-reviewer look', targets)?.target.id).toBe('c')
  })

  it('rejects partial-word matches and empty messages', () => {
    expect(parseBoardMention('@Reviewers go', targets)).toBeNull()
    expect(parseBoardMention('@Reviewer', targets)).toBeNull()
    expect(parseBoardMention('@nobody hi', targets)).toBeNull()
  })
})
