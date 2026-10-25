import { useEffect, useState } from 'react'
import {
  MonitorResponseSchema,
  monitorDisplayFreshness,
  monitorElapsedMs,
  monitorMonotonicNow,
  monitorWallNow,
  monitorInventoryLabel,
  type MonitorResponse,
  type MonitorLocalClocks
} from '../../../../shared/monitor-view-schema'
import { callRuntimeRpc } from '../../runtime/runtime-rpc-client'
import { Card } from '@/components/ui/card'
const gib = (value: number) => `${(value / 1024 ** 3).toFixed(1)} GiB`

const readLocal = () => callRuntimeRpc({ kind: 'local' }, 'system.monitor.status')
export function SystemMonitorCard({
  load = readLocal,
  clock = monitorMonotonicNow,
  wallClock = monitorWallNow
}: {
  load?: () => Promise<unknown>
  clock?: () => number
  wallClock?: () => number
} = {}) {
  const [reading, setReading] = useState<{
    result: MonitorResponse
    startedAt: MonitorLocalClocks
    elapsedMs: number | null
  } | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let disposed = false
    let pending = false
    const localClocks = (): MonitorLocalClocks => ({ monotonicMs: clock(), wallMs: wallClock() })
    const updateDisplay = () => {
      // Why: the one-second elapsed tick is display-only; a hidden window catches up on visibilitychange.
      if (disposed || document.visibilityState === 'hidden') {
        return
      }
      const now = localClocks()
      setReading((current) =>
        current
          ? { ...current, elapsedMs: monitorElapsedMs(current.startedAt, now, current.elapsedMs) }
          : current
      )
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        updateDisplay()
      }
    }
    const refresh = async () => {
      if (disposed || pending) {
        return
      }
      pending = true
      const startedAt = localClocks()
      try {
        const next = MonitorResponseSchema.parse(await load())
        if (!disposed) {
          setReading({
            result: next,
            startedAt,
            elapsedMs: monitorElapsedMs(startedAt, localClocks())
          })
          setError(false)
        }
      } catch {
        if (!disposed) {
          setReading(null)
          setError(true)
        }
      } finally {
        pending = false
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 60_000)
    const displayTimer = setInterval(updateDisplay, 1000)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      disposed = true
      clearInterval(timer)
      clearInterval(displayTimer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load, clock, wallClock])
  const result = reading?.result
  const view = result?.status
  const freshness =
    view && reading ? monitorDisplayFreshness(view, reading.elapsedMs) : 'unavailable'
  const label = error
    ? 'Unavailable'
    : !result
      ? 'Loading…'
      : !result.configured
        ? 'Not configured'
        : !view ||
            view.availability !== 'available' ||
            freshness === 'unavailable' ||
            freshness === 'clock_skew'
          ? 'Unavailable'
          : freshness === 'stale'
            ? 'Stale reading'
            : view.health
  return (
    <Card
      aria-label="Local device storage"
      className="my-2 w-full gap-1 border-border bg-card p-3 text-card-foreground"
    >
      <p className="text-xs font-semibold">Local device storage · {label}</p>
      {view && view.availability === 'available' ? (
        <div className="space-y-1 text-xs">
          {view.sampledAtMs !== null ? (
            <p className="text-muted-foreground">
              Sampled {new Date(view.sampledAtMs).toLocaleTimeString()}
            </p>
          ) : null}
          {view.volumes.map((volume, index) => (
            <p key={volume.id}>
              Available storage{view.volumes.length > 1 ? ` (volume ${index + 1})` : ''}:{' '}
              {gib(volume.freeBytes)} of {gib(volume.totalBytes)}
            </p>
          ))}
          {view.roots.map((root, index) => (
            <p key={root.id} className="break-words text-muted-foreground">
              {monitorInventoryLabel(root.id, index)}: {root.inventoryState ?? root.state} · logical{' '}
              {root.logicalBytes === null ? 'unknown' : gib(root.logicalBytes)} · allocated{' '}
              {root.allocatedBytes === null ? 'unknown' : gib(root.allocatedBytes)}
            </p>
          ))}
        </div>
      ) : null}
    </Card>
  )
}
