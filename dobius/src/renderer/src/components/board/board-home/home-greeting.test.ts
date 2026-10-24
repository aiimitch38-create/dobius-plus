import { describe, expect, it } from 'vitest'
import { homeTimeBucket, pickHomeGreeting } from './home-greeting'

const at = (hour: number, day = 10): Date => new Date(2026, 9, day, hour, 30)

describe('homeTimeBucket', () => {
  it.each([
    [5, 'morning'],
    [11, 'morning'],
    [12, 'afternoon'],
    [16, 'afternoon'],
    [17, 'evening'],
    [21, 'evening'],
    [22, 'lateNight'],
    [0, 'lateNight'],
    [4, 'lateNight']
  ] as const)('hour %i is %s', (hour, bucket) => {
    expect(homeTimeBucket(hour)).toBe(bucket)
  })
})

describe('pickHomeGreeting', () => {
  it('uses a line from the matching bucket', () => {
    const morning = new Set(
      Array.from({ length: 8 }, (_, d) => pickHomeGreeting(at(8, d + 1), null).line)
    )
    const evening = new Set(
      Array.from({ length: 8 }, (_, d) => pickHomeGreeting(at(19, d + 1), null).line)
    )
    expect(morning.size).toBeGreaterThan(1)
    expect([...morning].some((line) => evening.has(line))).toBe(false)
  })

  it('stays the same all day and changes on another day', () => {
    expect(pickHomeGreeting(at(13, 10), null).line).toBe(pickHomeGreeting(at(15, 10), null).line)
    expect(pickHomeGreeting(at(13, 10), null).line).not.toBe(
      pickHomeGreeting(at(13, 11), null).line
    )
  })

  it('carries a trimmed name and falls back to no name', () => {
    expect(pickHomeGreeting(at(9), '  Carson ').name).toBe('Carson')
    expect(pickHomeGreeting(at(9), '').name).toBeNull()
    expect(pickHomeGreeting(at(9), '   ').name).toBeNull()
    expect(pickHomeGreeting(at(9), null).name).toBeNull()
    expect(pickHomeGreeting(at(9), undefined).name).toBeNull()
  })

  it('always has a tagline', () => {
    for (const hour of [3, 9, 14, 20]) {
      expect(pickHomeGreeting(at(hour), null).tagline.length).toBeGreaterThan(0)
    }
  })
})
