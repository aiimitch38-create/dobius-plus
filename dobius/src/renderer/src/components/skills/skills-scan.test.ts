import { afterEach, describe, expect, it, vi } from 'vitest'
import { SkillScanTimeoutError, withSkillScanTimeout } from './skills-scan'

afterEach(() => {
  vi.useRealTimers()
})

describe('withSkillScanTimeout', () => {
  it('passes a finished scan through', async () => {
    await expect(withSkillScanTimeout(Promise.resolve(3), 100)).resolves.toBe(3)
  })

  it('ends a scan that never settles, so the page leaves "Scanning"', async () => {
    vi.useFakeTimers()
    const pending = withSkillScanTimeout(new Promise<never>(() => undefined), 100)
    const settled = expect(pending).rejects.toBeInstanceOf(SkillScanTimeoutError)
    await vi.advanceTimersByTimeAsync(101)
    await settled
  })

  it('keeps the original scan error', async () => {
    await expect(withSkillScanTimeout(Promise.reject(new Error('boom')), 100)).rejects.toThrow(
      'boom'
    )
  })
})
