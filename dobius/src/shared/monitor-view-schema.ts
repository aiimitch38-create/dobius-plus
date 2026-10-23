import { z } from 'zod'
import type { SystemMonitorView } from './system-monitor-view'

const bytes = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const milliseconds = z.number().finite().nonnegative()
export type ValidatedMonitorView = SystemMonitorView
export const MonitorViewSchema: z.ZodType<ValidatedMonitorView> = z.object({
  availability: z.enum(['available', 'unavailable']),
  deviceId: z.string().nullable(),
  health: z.enum(['unconfigured', 'healthy', 'warning', 'critical', 'unavailable']),
  freshness: z.enum(['fresh', 'stale', 'unavailable', 'clock_skew']),
  reason: z
    .enum([
      'missing_config',
      'invalid_config',
      'untrusted_config',
      'missing_snapshot',
      'invalid_snapshot',
      'untrusted_snapshot',
      'identity_mismatch',
      'clock_skew',
      'unsupported_platform'
    ])
    .nullable(),
  source: z.literal('private_local_file').nullable(),
  sampledAtMs: milliseconds.nullable(),
  ageMs: milliseconds.nullable(),
  // Older hosts carry no policy: parse their inventory, but never infer freshness.
  freshnessSeconds: z.number().finite().positive().max(86_400).nullable().default(null),
  cleanupEnabled: z.literal(false),
  volumes: z
    .array(
      z.object({
        id: z.string(),
        totalBytes: bytes,
        freeBytes: bytes,
        usedBytes: bytes,
        state: z.enum(['healthy', 'warning', 'critical'])
      })
    )
    .max(200),
  roots: z
    .array(
      z.object({
        id: z.string(),
        state: z.enum(['available', 'unavailable']),
        logicalBytes: bytes.nullable(),
        allocatedBytes: bytes.nullable(),
        inventoryState: z.enum(['scanning', 'partial', 'complete']).nullable()
      })
    )
    .max(200)
})
export const MonitorResponseSchema = z.object({
  configured: z.boolean(),
  status: MonitorViewSchema.nullable()
})
export type MonitorResponse = z.infer<typeof MonitorResponseSchema>

export type MonitorLocalClocks = { monotonicMs: number; wallMs: number }

export function monitorElapsedMs(
  startedAt: MonitorLocalClocks,
  now: MonitorLocalClocks,
  previousElapsed: number | null = 0
): number | null {
  if (
    previousElapsed === null ||
    ![startedAt.monotonicMs, startedAt.wallMs, now.monotonicMs, now.wallMs, previousElapsed].every(
      Number.isFinite
    )
  ) {
    return null
  }
  // Some monotonic clocks pause in sleep. Both deltas are LOCAL; a high-water
  // mark prevents a later wall-clock correction from renewing this reading.
  return Math.max(
    now.monotonicMs - startedAt.monotonicMs,
    now.wallMs - startedAt.wallMs,
    previousElapsed,
    0
  )
}

export function monitorDisplayFreshness(
  view: ValidatedMonitorView,
  elapsedMs: number | null
): ValidatedMonitorView['freshness'] {
  if (view.availability !== 'available' || view.freshness === 'unavailable') {
    return 'unavailable'
  }
  if (view.freshness === 'clock_skew') {
    return 'clock_skew'
  }
  if (view.freshness === 'stale') {
    return 'stale'
  }
  if (
    view.ageMs === null ||
    view.freshnessSeconds === null ||
    elapsedMs === null ||
    !Number.isFinite(elapsedMs) ||
    elapsedMs < 0
  ) {
    return 'unavailable'
  }
  return view.ageMs + elapsedMs <= view.freshnessSeconds * 1000 ? 'fresh' : 'stale'
}

export const monitorMonotonicNow = (): number => performance.now()
export const monitorWallNow = (): number => Date.now()

export function monitorInventoryLabel(id: string, index: number): string {
  if (id === 'dobius' || id === 'dobius-source') {
    return 'Dobius source'
  }
  if (id === 'obsidian') {
    return 'Obsidian'
  }
  // Unknown identifiers are registration keys, not user-facing folder names.
  return `Tracked folder ${index + 1}`
}
