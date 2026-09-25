import { describe, expect, it } from 'vitest'
import { formatRunAge } from './agent-run-age'

const NOW = 1_000_000_000_000

describe('formatRunAge', () => {
  it.each([
    [NOW - 30_000, 'just now'],
    [NOW - 5 * 60_000, '5m ago'],
    [NOW - 3 * 60 * 60_000, '3h ago'],
    [NOW - 49 * 60 * 60_000, '2d ago'],
    [NOW + 60_000, 'just now']
  ])('formats %d', (at, label) => {
    expect(formatRunAge(at, NOW)).toBe(label)
  })
})
