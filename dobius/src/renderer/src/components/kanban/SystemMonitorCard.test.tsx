// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, cleanup, act } from '@testing-library/react'
import { SystemMonitorCard } from './SystemMonitorCard'
import { callRuntimeRpc } from '../../runtime/runtime-rpc-client'
vi.mock('../../runtime/runtime-rpc-client', () => ({ callRuntimeRpc: vi.fn() }))
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})
const view = (freshness = 'fresh') => ({
  configured: true,
  status: {
    availability: 'available',
    deviceId: 'laptop',
    health: 'critical',
    freshness,
    freshnessSeconds: 20,
    reason: null,
    source: 'private_local_file',
    sampledAtMs: 1000,
    ageMs: 0,
    cleanupEnabled: false,
    volumes: [
      {
        id: 'volume',
        totalBytes: 100 * 1024 ** 3,
        freeBytes: Math.floor(7.2 * 1024 ** 3),
        usedBytes: 1,
        state: 'critical'
      }
    ],
    roots: [
      {
        id: 'dobius-source',
        state: 'available',
        logicalBytes: 1,
        allocatedBytes: 1,
        inventoryState: 'partial'
      }
    ]
  }
})
describe('local storage health card', () => {
  it('expires on visibility after sleep with paused monotonic time and retains stale after wall rollback', async () => {
    vi.useFakeTimers()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    let wall = 1_000_000
    const clock = () => 100.125
    const wallClock = () => wall
    const data = view()
    data.status.sampledAtMs = 1791920839147.629
    data.status.ageMs = 15190.623
    const load = vi.fn(async () => data)
    const { unmount } = render(
      <SystemMonitorCard load={load} clock={clock} wallClock={wallClock} />
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByText('Local device storage · critical')).toBeTruthy()
    wall += 600_000
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(screen.getByText('Local device storage · Stale reading')).toBeTruthy()
    wall -= 1_200_000
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByText('Local device storage · Stale reading')).toBeTruthy()
    expect(load).toHaveBeenCalledTimes(1)
    unmount()
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    expect(load).toHaveBeenCalledTimes(1)
  })
  it('accepts fractional live readings and expires locally each second without another poll', async () => {
    vi.useFakeTimers()
    let monotonic = 100.125
    const clock = () => monotonic
    const data = view()
    data.status.sampledAtMs = 1791920839147.629
    data.status.ageMs = 15190.623
    const load = vi.fn(async () => data)
    await act(async () => {
      render(<SystemMonitorCard load={load} clock={clock} />)
    })
    expect(screen.getByText('Local device storage · critical')).toBeTruthy()
    vi.setSystemTime(new Date('2000-01-01'))
    monotonic += 5000.5
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })
    expect(screen.getByText('Local device storage · Stale reading')).toBeTruthy()
    expect(load).toHaveBeenCalledTimes(1)
    // A resumed display tick ages the original anchor even if ticks were suspended.
    monotonic += 600_000.25
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByText('Local device storage · Stale reading')).toBeTruthy()
    expect(load).toHaveBeenCalledTimes(1)
  })
  it('counts delayed delivery from request start and fails closed on a legacy missing policy', async () => {
    let monotonic = 0.25
    const clock = () => monotonic
    let release!: (value: unknown) => void
    const load = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    const { unmount } = render(<SystemMonitorCard load={load} clock={clock} />)
    monotonic = 8000.75
    const data = view()
    data.status.sampledAtMs = 1791920839147.629
    data.status.ageMs = 15190.623
    await act(async () => {
      release(data)
    })
    expect(screen.getByText('Local device storage · Stale reading')).toBeTruthy()
    unmount()
    const { freshnessSeconds: _policy, ...legacy } = data.status
    await act(async () => {
      render(
        <SystemMonitorCard
          load={async () => ({ configured: true, status: legacy })}
          clock={clock}
        />
      )
    })
    expect(screen.getByText('Local device storage · Unavailable')).toBeTruthy()
  })
  it('always reads explicit local device independent of the central job environment', async () => {
    vi.mocked(callRuntimeRpc).mockResolvedValue({ configured: false, status: null })
    render(<SystemMonitorCard />)
    await waitFor(() =>
      expect(screen.getByText('Local device storage · Not configured')).toBeTruthy()
    )
    expect(callRuntimeRpc).toHaveBeenCalledWith({ kind: 'local' }, 'system.monitor.status')
  })
  it('shows stale bounded inventory and distinguishes unavailable/malformed health', async () => {
    const data = view('stale')
    data.status.volumes[0].freeBytes = Math.floor(7.2 * 1024 ** 3)
    const { unmount } = render(<SystemMonitorCard load={async () => data} />)
    await waitFor(() =>
      expect(screen.getByText('Local device storage · Stale reading')).toBeTruthy()
    )
    expect(screen.getByText(/Available storage: 7.2 GiB/)).toBeTruthy()
    expect(screen.queryByText(/Volume volume/)).toBeNull()
    expect(screen.getByText(/Dobius source: partial/)).toBeTruthy()
    expect(screen.queryByText(/Root dobius-source/)).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    unmount()
    render(<SystemMonitorCard load={async () => ({ configured: true, status: { roots: null } })} />)
    await waitFor(() => expect(screen.getByText('Local device storage · Unavailable')).toBeTruthy())
  })
})
