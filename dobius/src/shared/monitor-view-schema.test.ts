import { describe, expect, it, vi } from 'vitest'
import {
  MonitorResponseSchema,
  MonitorViewSchema,
  monitorDisplayFreshness,
  monitorElapsedMs,
  monitorMonotonicNow,
  monitorWallNow
} from './monitor-view-schema'

const live = {
  availability: 'available',
  deviceId: 'local-device',
  health: 'critical',
  freshness: 'fresh',
  reason: null,
  source: 'private_local_file',
  sampledAtMs: 1791920839147.629,
  ageMs: 15190.623,
  freshnessSeconds: 20,
  cleanupEnabled: false,
  volumes: [{ id: 'volume-id', totalBytes: 100, freeBytes: 7, usedBytes: 93, state: 'critical' }],
  roots: [
    {
      id: 'root-id',
      state: 'available',
      logicalBytes: 10,
      allocatedBytes: 8,
      inventoryState: 'partial'
    }
  ]
}
describe('shared typed monitor view and client freshness', () => {
  it('accepts actual fractional Unix-millisecond timestamps and age while retaining integral bytes', () => {
    const { status } = MonitorResponseSchema.parse({ configured: true, status: live })
    expect(status?.sampledAtMs).toBe(1791920839147.629)
    expect(status?.ageMs).toBe(15190.623)
    expect(
      MonitorViewSchema.safeParse({ ...live, volumes: [{ ...live.volumes[0], freeBytes: 7.2 }] })
        .success
    ).toBe(false)
  })
  it.each([-1, NaN, Infinity, -Infinity])(
    'rejects non-finite/negative milliseconds %s',
    (value) => {
      expect(MonitorViewSchema.safeParse({ ...live, sampledAtMs: value }).success).toBe(false)
      expect(MonitorViewSchema.safeParse({ ...live, ageMs: value }).success).toBe(false)
    }
  )
  it('counts latency from request start, with fractional clocks and exact TTL boundary', () => {
    const view = MonitorViewSchema.parse(live)
    const startedAt = 100.125
    const anchor = { monotonicMs: startedAt, wallMs: 1_000_000 }
    const display = (delta: number) =>
      monitorDisplayFreshness(
        view,
        monitorElapsedMs(anchor, { monotonicMs: startedAt + delta, wallMs: anchor.wallMs })
      )
    expect(display(1000.25)).toBe('fresh')
    expect(display(4809.377)).toBe('fresh')
    expect(display(4809.378)).toBe('stale')
    expect(display(8000)).toBe('stale')
  })
  it('ages through sleep without resetting the TTL at delivery or requiring intermediate ticks', () => {
    const view = MonitorViewSchema.parse(live)
    const anchor = { monotonicMs: 0.25, wallMs: 1_000_000 }
    expect(monitorDisplayFreshness(view, monitorElapsedMs(anchor, anchor))).toBe('fresh')
    expect(
      monitorDisplayFreshness(
        view,
        monitorElapsedMs(anchor, { monotonicMs: 600_000.75, wallMs: anchor.wallMs })
      )
    ).toBe('stale')
  })
  it('counts local wall elapsed when the monotonic clock pauses through OS sleep', () => {
    const anchor = { monotonicMs: 100.125, wallMs: 1_000_000 }
    const elapsed = monitorElapsedMs(anchor, {
      monotonicMs: anchor.monotonicMs,
      wallMs: anchor.wallMs + 600_000
    })
    expect(elapsed).toBe(600_000)
    expect(monitorDisplayFreshness(MonitorViewSchema.parse(live), elapsed)).toBe('stale')
  })
  it('never renews TTL after a forward wall jump is corrected backwards', () => {
    const anchor = { monotonicMs: 100.125, wallMs: 1_000_000 }
    const elapsed = monitorElapsedMs(anchor, { monotonicMs: 100.125, wallMs: 1_600_000 })
    const corrected = monitorElapsedMs(anchor, { monotonicMs: 100.125, wallMs: 400_000 }, elapsed)
    expect(corrected).toBe(600_000)
    expect(monitorDisplayFreshness(MonitorViewSchema.parse(live), corrected)).toBe('stale')
    expect(monitorElapsedMs(anchor, { monotonicMs: 100, wallMs: 999_999 })).toBe(0)
  })
  it('uses local deltas when the wall clock goes backwards without comparing the host timestamp', () => {
    const anchor = { monotonicMs: 0.125, wallMs: 1_000_000 }
    const wall = vi.spyOn(Date, 'now').mockReturnValue(-1_000_000)
    const monotonic = vi.spyOn(performance, 'now').mockReturnValue(8000.125)
    try {
      expect(
        monitorDisplayFreshness(
          MonitorViewSchema.parse(live),
          monitorElapsedMs(anchor, { monotonicMs: monitorMonotonicNow(), wallMs: monitorWallNow() })
        )
      ).toBe('stale')
      expect(wall).toHaveBeenCalledTimes(1)
      expect(
        monitorDisplayFreshness(MonitorViewSchema.parse({ ...live, sampledAtMs: 0 }), 8000)
      ).toBe('stale')
    } finally {
      wall.mockRestore()
      monotonic.mockRestore()
    }
  })
  it('fails closed on absent/null policy, missing age or invalid local clocks', () => {
    const { freshnessSeconds: _policy, ...legacy } = live
    expect(monitorDisplayFreshness(MonitorViewSchema.parse(legacy), 0)).toBe('unavailable')
    expect(
      monitorDisplayFreshness(MonitorViewSchema.parse({ ...live, freshnessSeconds: null }), 0)
    ).toBe('unavailable')
    expect(monitorDisplayFreshness(MonitorViewSchema.parse({ ...live, ageMs: null }), 0)).toBe(
      'unavailable'
    )
    const invalid = monitorElapsedMs(
      { monotonicMs: 0, wallMs: 0 },
      { monotonicMs: Infinity, wallMs: 1 }
    )
    expect(monitorDisplayFreshness(MonitorViewSchema.parse(live), invalid)).toBe('unavailable')
  })
  it('never upgrades server stale/skew/unavailable observations to fresh', () => {
    for (const freshness of ['stale', 'clock_skew', 'unavailable']) {
      expect(monitorDisplayFreshness(MonitorViewSchema.parse({ ...live, freshness }), 0)).toBe(
        freshness
      )
    }
  })
})
