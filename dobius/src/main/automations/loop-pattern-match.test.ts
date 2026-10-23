import { describe, expect, it } from 'vitest'
import { validateLoopPattern } from '../../shared/automation-loops'
import { LOOP_MATCH_MAX_CHARS, boundLoopMatchLines, matchLoopPattern } from './loop-pattern-match'

describe('matchLoopPattern', () => {
  it('finds the first matching line', () => {
    expect(matchLoopPattern('FAIL', ['ok', 'tests FAIL', 'FAIL 2'])).toEqual({
      kind: 'match',
      line: 'tests FAIL'
    })
    expect(matchLoopPattern('FAIL', ['ok'])).toEqual({ kind: 'none' })
  })

  it('the reviewer pattern (.*,){12}X is rejected up front and, if run anyway, times out fast', () => {
    expect(validateLoopPattern('(.*,){12}X')).toEqual({ ok: false, error: 'unsafe' })
    const hostile = `${','.repeat(30)}${'a'.repeat(400)}`
    const started = performance.now()
    expect(matchLoopPattern('(.*,){12}X', [hostile], 50)).toEqual({ kind: 'timeout' })
    expect(performance.now() - started).toBeLessThan(2_000)
  })

  it('times out classic catastrophic backtracking too', () => {
    expect(matchLoopPattern('(a+)+$', [`${'a'.repeat(40)}!`], 50)).toEqual({ kind: 'timeout' })
  })

  it('bounds scanned text, keeping the newest lines', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `${i}`.padEnd(1_000, '.'))
    const bounded = boundLoopMatchLines(lines)
    expect(bounded.reduce((n, l) => n + l.length, 0)).toBeLessThanOrEqual(
      LOOP_MATCH_MAX_CHARS + 500
    )
    expect(bounded.at(-1)?.startsWith('499')).toBe(true)
    expect(bounded.every((l) => l.length <= 500)).toBe(true)
  })
})
