import * as crypto from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { constantTimeEqual } from './constant-time-equal'

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof crypto>()
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) }
})

describe('constantTimeEqual (#22)', () => {
  it('matches only the exact token', () => {
    expect(constantTimeEqual('secret-token', 'secret-token')).toBe(true)
    expect(constantTimeEqual('secret-tokeN', 'secret-token')).toBe(false)
  })

  it('tolerates wrong lengths and non-string input without throwing', () => {
    expect(constantTimeEqual('s', 'secret-token')).toBe(false)
    expect(constantTimeEqual('secret-token-and-more', 'secret-token')).toBe(false)
    expect(constantTimeEqual(undefined, 'secret-token')).toBe(false)
    expect(constantTimeEqual(['secret-token'], 'secret-token')).toBe(false)
    expect(constantTimeEqual(42, 'secret-token')).toBe(false)
  })

  it('never authenticates against an empty expected token', () => {
    expect(constantTimeEqual('', '')).toBe(false)
  })

  it('compares through timingSafeEqual, not ===', () => {
    const spy = vi.mocked(crypto.timingSafeEqual)
    spy.mockClear()
    constantTimeEqual('abc', 'abd')
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
