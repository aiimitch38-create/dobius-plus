import { describe, expect, it } from 'vitest'
import {
  boardOutputRelativePath,
  formatOutputTimestamp,
  slugifyOutputTitle
} from './board-output-filename'

describe('slugifyOutputTitle', () => {
  it('lowercases and dashes punctuation and spaces', () => {
    expect(slugifyOutputTitle('Code Review: Claude 1')).toBe('code-review-claude-1')
  })

  it('trims leading and trailing dashes', () => {
    expect(slugifyOutputTitle('  --Weird Title--  ')).toBe('weird-title')
  })

  it('falls back to "output" when nothing survives slugging', () => {
    expect(slugifyOutputTitle('!!!')).toBe('output')
  })
})

describe('formatOutputTimestamp', () => {
  it('pads to YYYY-MM-DD_HHMMSS', () => {
    const at = new Date(2026, 0, 5, 3, 7, 9)
    expect(formatOutputTimestamp(at)).toBe('2026-01-05_030709')
  })
})

describe('boardOutputRelativePath', () => {
  it('joins the timestamp and slug under outputs/', () => {
    const at = new Date(2026, 9, 23, 14, 30, 12)
    expect(boardOutputRelativePath('Code Review', at)).toBe(
      'outputs/2026-10-23_143012-code-review.md'
    )
  })
})
