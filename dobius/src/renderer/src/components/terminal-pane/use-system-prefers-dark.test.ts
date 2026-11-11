import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getSystemPrefersDarkSnapshot,
  resetSystemPrefersDarkSubscriptionForTests,
  subscribeToSystemPrefersDarkChange
} from './use-system-prefers-dark'

const NOON = new Date(2026, 0, 1, 12, 0, 0)
const MIDNIGHT = new Date(2026, 0, 1, 0, 0, 0)

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  resetSystemPrefersDarkSubscriptionForTests()
  vi.useRealTimers()
})

describe('useSystemPrefersDark subscription store', () => {
  it('caches a snapshot resolved from the local clock, not an OS signal', () => {
    vi.setSystemTime(NOON)
    expect(getSystemPrefersDarkSnapshot()).toBe(false)

    vi.setSystemTime(MIDNIGHT)
    // Why: snapshot stays cached until something re-triggers a refresh
    // (a subscriber's periodic re-check), matching useSyncExternalStore's
    // "read the cached snapshot" contract.
    expect(getSystemPrefersDarkSnapshot()).toBe(false)
  })

  it('shares one timer across subscribers and notifies on a day/night flip', () => {
    vi.setSystemTime(NOON)
    const firstSubscriber = vi.fn()
    const secondSubscriber = vi.fn()

    const unsubscribeFirst = subscribeToSystemPrefersDarkChange(firstSubscriber)
    const unsubscribeSecond = subscribeToSystemPrefersDarkChange(secondSubscriber)

    expect(getSystemPrefersDarkSnapshot()).toBe(false)

    vi.setSystemTime(MIDNIGHT)
    vi.advanceTimersByTime(60_000)

    expect(getSystemPrefersDarkSnapshot()).toBe(true)
    expect(firstSubscriber).toHaveBeenCalledTimes(1)
    expect(secondSubscriber).toHaveBeenCalledTimes(1)

    unsubscribeFirst()
    vi.setSystemTime(NOON)
    vi.advanceTimersByTime(60_000)

    expect(getSystemPrefersDarkSnapshot()).toBe(false)
    expect(firstSubscriber).toHaveBeenCalledTimes(1)
    expect(secondSubscriber).toHaveBeenCalledTimes(2)

    unsubscribeSecond()
  })
})
