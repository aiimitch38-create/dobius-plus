import { describe, expect, it, vi } from 'vitest'
import { getOsIdleSeconds } from './idle-time'

describe('getOsIdleSeconds', () => {
  it('floors and returns the reported idle seconds', () => {
    expect(getOsIdleSeconds({ getSystemIdleTime: () => 42.9 })).toBe(42)
  })

  it('returns null when the platform reports a negative value', () => {
    expect(getOsIdleSeconds({ getSystemIdleTime: () => -1 })).toBeNull()
  })

  it('returns null when the platform reports a non-finite value', () => {
    expect(getOsIdleSeconds({ getSystemIdleTime: () => Number.NaN })).toBeNull()
  })

  it('returns null instead of throwing when the OS query is unsupported', () => {
    const getSystemIdleTime = vi.fn(() => {
      throw new Error('idle time unavailable on this compositor')
    })
    expect(getOsIdleSeconds({ getSystemIdleTime })).toBeNull()
  })

  it('returns zero when the user is active right now', () => {
    expect(getOsIdleSeconds({ getSystemIdleTime: () => 0 })).toBe(0)
  })
})
