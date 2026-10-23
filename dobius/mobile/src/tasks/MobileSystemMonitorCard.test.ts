import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileSystemMonitorCard } from './MobileSystemMonitorCard'
const appState = vi.hoisted(() => ({
  notify: null as ((state: string) => void) | null,
  remove: vi.fn()
}))
vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  AppState: {
    addEventListener: (_event: string, notify: (state: string) => void) => {
      appState.notify = notify
      return { remove: appState.remove }
    }
  },
  StyleSheet: { create: (value: unknown) => value }
}))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }))
const context = vi.hoisted(() => ({ client: { sendRequest: vi.fn() } }))
vi.mock('../transport/client-context', () => ({
  useHostClient: () => ({ client: context.client, state: 'connected' })
}))
let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
  vi.clearAllMocks()
  appState.notify = null
})
const data = {
  configured: true,
  status: {
    availability: 'available',
    deviceId: 'vps-device',
    health: 'critical',
    freshness: 'stale',
    freshnessSeconds: 20,
    reason: null,
    source: 'private_local_file',
    sampledAtMs: 1000,
    ageMs: 120000,
    cleanupEnabled: false,
    volumes: [
      {
        id: 'vol',
        totalBytes: 100 * 1024 ** 3,
        freeBytes: Math.floor(7.2 * 1024 ** 3),
        usedBytes: 1,
        state: 'critical'
      }
    ],
    roots: [
      {
        id: 'root-id',
        state: 'available',
        logicalBytes: 1,
        allocatedBytes: null,
        inventoryState: 'partial'
      }
    ]
  }
}
describe('current-host monitor scope', () => {
  it('expires immediately on AppState resume with paused monotonic time without additional polling', async () => {
    vi.useFakeTimers()
    let wall = 1_000_000
    const clock = vi.fn(() => 100.125)
    const wallClock = () => wall
    context.client.sendRequest.mockResolvedValue({
      ok: true,
      result: {
        ...data,
        status: {
          ...data.status,
          freshness: 'fresh',
          sampledAtMs: 1791920839147.629,
          ageMs: 15190.623
        }
      }
    })
    await act(async () => {
      renderer = create(createElement(MobileSystemMonitorCard, { hostId: 'vps', clock, wallClock }))
    })
    expect(JSON.stringify(renderer?.toJSON())).toContain('critical')
    act(() => appState.notify?.('background'))
    wall += 600_000
    act(() => appState.notify?.('active'))
    expect(JSON.stringify(renderer?.toJSON())).toContain('Stale reading')
    wall -= 1_200_000
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(JSON.stringify(renderer?.toJSON())).toContain('Stale reading')
    expect(context.client.sendRequest).toHaveBeenCalledTimes(1)
    act(() => renderer?.unmount())
    renderer = null
    expect(appState.remove).toHaveBeenCalledTimes(1)
    const samples = clock.mock.calls.length
    act(() => appState.notify?.('active'))
    expect(clock).toHaveBeenCalledTimes(samples)
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    expect(context.client.sendRequest).toHaveBeenCalledTimes(1)
  })
  it('accepts fractional live age and updates stale display without polling after clock/sleep changes', async () => {
    vi.useFakeTimers()
    let monotonic = 100.125
    const clock = () => monotonic
    const live = {
      ...data,
      status: {
        ...data.status,
        freshness: 'fresh',
        sampledAtMs: 1791920839147.629,
        ageMs: 15190.623
      }
    }
    context.client.sendRequest.mockResolvedValue({ ok: true, result: live })
    await act(async () => {
      renderer = create(createElement(MobileSystemMonitorCard, { hostId: 'vps', clock }))
    })
    expect(JSON.stringify(renderer?.toJSON())).toContain('critical')
    vi.setSystemTime(new Date('2000-01-01'))
    monotonic += 5000.5
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })
    expect(JSON.stringify(renderer?.toJSON())).toContain('Stale reading')
    monotonic += 600_000.25
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(JSON.stringify(renderer?.toJSON())).toContain('Stale reading')
    expect(context.client.sendRequest).toHaveBeenCalledTimes(1)
  })
  it('does not reset TTL on late delivery or assume absent policy', async () => {
    let monotonic = 0.125
    const clock = () => monotonic
    let release!: (value: unknown) => void
    context.client.sendRequest.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve
      })
    )
    await act(async () => {
      renderer = create(createElement(MobileSystemMonitorCard, { hostId: 'old', clock }))
    })
    monotonic += 8000.25
    const live = {
      ...data,
      status: {
        ...data.status,
        freshness: 'fresh',
        sampledAtMs: 1791920839147.629,
        ageMs: 15190.623
      }
    }
    await act(async () => {
      release({ ok: true, result: live })
    })
    expect(JSON.stringify(renderer?.toJSON())).toContain('Stale reading')
    const { freshnessSeconds: _policy, ...legacy } = live.status
    context.client.sendRequest.mockResolvedValueOnce({
      ok: true,
      result: { configured: true, status: legacy }
    })
    await act(async () => {
      renderer?.update(createElement(MobileSystemMonitorCard, { hostId: 'new', clock }))
    })
    expect(JSON.stringify(renderer?.toJSON())).toContain('Unavailable')
  })
  it('labels only its explicit host and displays available storage/partial inventory without controls', async () => {
    context.client.sendRequest.mockResolvedValue({ ok: true, result: data })
    await act(async () => {
      renderer = create(createElement(MobileSystemMonitorCard, { hostId: 'vps' }))
    })
    const output = JSON.stringify(renderer?.toJSON())
    expect(output).toContain('vps')
    expect(output).toContain('Stale reading')
    expect(output).toContain('7.2 GiB')
    expect(output).toContain('Available storage')
    expect(output).not.toContain('Volume vol')
    expect(output).toContain('partial')
    expect(output).toContain('Tracked folder 1')
    expect(output).not.toContain('root-id')
    expect(output).not.toContain('Pressable')
    expect(context.client.sendRequest).toHaveBeenCalledWith('system.monitor.status')
  })
  it('rejects a late old-host health reply and clears malformed health', async () => {
    let release!: (value: unknown) => void
    context.client.sendRequest
      .mockReturnValueOnce(
        new Promise((resolve) => {
          release = resolve
        })
      )
      .mockResolvedValueOnce({ ok: true, result: { configured: true, status: { roots: null } } })
    await act(async () => {
      renderer = create(createElement(MobileSystemMonitorCard, { hostId: 'old' }))
    })
    await act(async () => {
      renderer?.update(createElement(MobileSystemMonitorCard, { hostId: 'new' }))
    })
    await act(async () => {
      release({ ok: true, result: data })
      await Promise.resolve()
    })
    const output = JSON.stringify(renderer?.toJSON())
    expect(output).toContain('new')
    expect(output).toContain('Unavailable')
    expect(output).not.toContain('7.2 GiB')
  })
})
