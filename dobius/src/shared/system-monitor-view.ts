import type { StorageFreshness, StorageHealth } from './system-monitor'

export type SystemMonitorViewReason =
  | 'missing_config'
  | 'invalid_config'
  | 'untrusted_config'
  | 'missing_snapshot'
  | 'invalid_snapshot'
  | 'untrusted_snapshot'
  | 'identity_mismatch'
  | 'clock_skew'
  | 'unsupported_platform'

export type SystemMonitorView = {
  availability: 'available' | 'unavailable'
  deviceId: string | null
  health: StorageHealth
  freshness: StorageFreshness
  reason: SystemMonitorViewReason | null
  source: 'private_local_file' | null
  sampledAtMs: number | null
  ageMs: number | null
  freshnessSeconds: number | null
  volumes: {
    id: string
    totalBytes: number
    freeBytes: number
    usedBytes: number
    state: 'healthy' | 'warning' | 'critical'
  }[]
  roots: {
    id: string
    state: 'available' | 'unavailable'
    logicalBytes: number | null
    allocatedBytes: number | null
    inventoryState: 'scanning' | 'partial' | 'complete' | null
  }[]
  cleanupEnabled: false
}
