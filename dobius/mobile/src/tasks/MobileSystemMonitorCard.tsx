import { useEffect, useState } from 'react'
import { View, Text, StyleSheet, AppState } from 'react-native'
import {
  MonitorResponseSchema,
  monitorDisplayFreshness,
  monitorElapsedMs,
  monitorMonotonicNow,
  monitorWallNow,
  monitorInventoryLabel,
  type MonitorResponse,
  type MonitorLocalClocks
} from '../../../src/shared/monitor-view-schema'
import { useHostClient } from '../transport/client-context'
import { colors, spacing, typography } from '../theme/mobile-theme'
const gib = (value: number) => `${(value / 1024 ** 3).toFixed(1)} GiB`

export function MobileSystemMonitorCard({
  hostId,
  clock = monitorMonotonicNow,
  wallClock = monitorWallNow
}: {
  hostId: string
  clock?: () => number
  wallClock?: () => number
}) {
  const { client, state } = useHostClient(hostId)
  const [value, setValue] = useState<{
    hostId: string
    result: MonitorResponse | null
    startedAt: MonitorLocalClocks
    elapsedMs: number | null
    error: boolean
  } | null>(null)
  useEffect(() => {
    let disposed = false
    let pending = false
    setValue(null)
    if (!client || state !== 'connected') {
      return
    }
    const localClocks = (): MonitorLocalClocks => ({ monotonicMs: clock(), wallMs: wallClock() })
    const updateDisplay = () => {
      if (disposed) {
        return
      }
      const now = localClocks()
      setValue((current) =>
        current
          ? { ...current, elapsedMs: monitorElapsedMs(current.startedAt, now, current.elapsedMs) }
          : current
      )
    }
    const refresh = async () => {
      if (disposed || pending) {
        return
      }
      pending = true
      const startedAt = localClocks()
      try {
        const response = await client.sendRequest('system.monitor.status')
        if (!response.ok) {
          throw new Error('Monitor unavailable')
        }
        const result = MonitorResponseSchema.parse(response.result)
        if (!disposed) {
          setValue({
            hostId,
            result,
            startedAt,
            elapsedMs: monitorElapsedMs(startedAt, localClocks()),
            error: false
          })
        }
      } catch {
        if (!disposed) {
          setValue({ hostId, result: null, startedAt, elapsedMs: null, error: true })
        }
      } finally {
        pending = false
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 60_000)
    const displayTimer = setInterval(updateDisplay, 1000)
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        updateDisplay()
      }
    })
    return () => {
      disposed = true
      clearInterval(timer)
      clearInterval(displayTimer)
      subscription.remove()
    }
  }, [client, state, hostId, clock, wallClock])
  const current = value?.hostId === hostId ? value : null
  const result = current?.result
  const view = result?.status
  const freshness =
    view && current ? monitorDisplayFreshness(view, current.elapsedMs) : 'unavailable'
  const label =
    state !== 'connected' || current?.error
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
    <View accessibilityLabel="Current host storage" style={styles.card}>
      <Text style={styles.title}>
        Current host {hostId} storage · {label}
      </Text>
      {state === 'connected' && view && view.availability === 'available' ? (
        <>
          {view.sampledAtMs !== null ? (
            <Text style={styles.meta}>
              Sampled {new Date(view.sampledAtMs).toLocaleTimeString()}
            </Text>
          ) : null}
          {view.volumes.map((volume, index) => (
            <Text key={volume.id} style={styles.body}>
              Available storage{view.volumes.length > 1 ? ` (volume ${index + 1})` : ''}:{' '}
              {gib(volume.freeBytes)} of {gib(volume.totalBytes)}
            </Text>
          ))}
          {view.roots.map((root, index) => (
            <Text key={root.id} style={styles.meta}>
              {monitorInventoryLabel(root.id, index)}: {root.inventoryState ?? root.state} · logical{' '}
              {root.logicalBytes === null ? 'unknown' : gib(root.logicalBytes)} · allocated{' '}
              {root.allocatedBytes === null ? 'unknown' : gib(root.allocatedBytes)}
            </Text>
          ))}
        </>
      ) : null}
    </View>
  )
}
const styles = StyleSheet.create({
  card: {
    margin: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgPanel
  },
  title: { fontSize: typography.metaSize, fontWeight: '600', color: colors.textPrimary },
  body: { fontSize: typography.metaSize, color: colors.textPrimary, marginTop: spacing.xs },
  meta: { fontSize: typography.metaSize, color: colors.textSecondary, marginTop: spacing.xs }
})
