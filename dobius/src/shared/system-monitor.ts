/** Local read-only monitor contracts. Timestamps are Unix seconds, sizes are bytes. */
export const SYSTEM_MONITOR_SCHEMA_VERSION = 1 as const

export type StorageHealth = 'unconfigured' | 'healthy' | 'warning' | 'critical' | 'unavailable'
export type StorageFreshness = 'fresh' | 'stale' | 'unavailable' | 'clock_skew'

export type MonitoredRoot = {
  id: string
  path: string
  device: number
  inode: number
}

export type StoragePolicy = {
  sampleSeconds: number
  freshnessSeconds: number
  warnBytes: number
  warnFraction: number
  criticalBytes: number
  criticalFraction: number
  hysteresisBytes: number
  hysteresisFraction: number
  safetyMarginBytes: number
  unknownEstimateBytes: number
}

export type SystemMonitorConfig = {
  schemaVersion: typeof SYSTEM_MONITOR_SCHEMA_VERSION
  deviceId: string
  roots: MonitoredRoot[]
  policy: StoragePolicy
  scan: {
    maxEntriesPerTick: number
    maxSecondsPerTick: number
    maxDirectories: number
    maxInodes: number
    maxDepth: number
    refreshSeconds: number
  }
}

export type RootInventoryStatus = {
  generation: string
  state: 'scanning' | 'partial' | 'complete'
  startedAt: number
  finishedAt: number | null
  logicalBytes: number
  allocatedBytes: number | null
  files: number
  directories: number
  pendingDirectories: number
  skipped: { symlinks: number; mounts: number; specialFiles: number; hardlinks: number }
  errorCount: number
  errors: { reason: string; relativePath: string; pathTruncated: boolean }[]
  limitReached: boolean
  // APFS sharing, compression, clones and live edits prevent treating totals as reclaimable.
  reclaimableBytes: null
  consistency: 'live_observation'
}

export type MonitoredVolumeStatus = {
  id: string
  totalBytes: number
  freeBytes: number
  usedBytes: number
  state: 'healthy' | 'warning' | 'critical'
  thresholds: { warningBytes: number; criticalBytes: number; hysteresisBytes: number }
  history: { sampledAt: number; freeBytes: number }[]
  freeBytesPerSecond: number | null
}

export type MonitoredRootStatus = {
  id: string
  path: string
  identity: { device: number; inode: number }
  state: 'available' | 'unavailable'
  volumeId: string | null
  reason?: 'root_unavailable_or_identity_changed'
  inventory: RootInventoryStatus | null
}

export type StorageMonitorAlert = {
  sampledAt: number
  kind: 'root_state_changed' | 'space_state_changed'
  rootId?: string
  volumeId?: string
  from: string | null
  to: string
}

export type SystemMonitorStatus = {
  schemaVersion: typeof SYSTEM_MONITOR_SCHEMA_VERSION
  deviceId: string
  sampledAt: number
  freshnessSeconds: number
  health: StorageHealth
  roots: MonitoredRootStatus[]
  volumes: MonitoredVolumeStatus[]
  alerts: StorageMonitorAlert[]
  cleanupReceipts: never[]
  cleanupEnabled: false
  publisher: 'private_local_file'
  platform: string
  inventorySupported: boolean
  topConsumers: {
    rootId: string
    logicalBytes: number
    allocatedBytes: number | null
    state: RootInventoryStatus['state']
  }[]
  freshness?: StorageFreshness
}

export type StorageAdmissionDecision = {
  schemaVersion: typeof SYSTEM_MONITOR_SCHEMA_VERSION
  allowed: boolean
  reason:
    | StorageFreshness
    | 'root_unavailable'
    | 'root_identity_changed'
    | 'volume_unavailable'
    | 'invalid_space_estimate'
    | 'admitted'
    | 'insufficient_space'
  rootId: string
  freshness: StorageFreshness
  volumeId?: string
  estimatedWorkingBytes?: number
  estimateSource?: 'unknown_policy' | 'job'
  reservedBytes?: number
  safetyMarginBytes?: number
  requiredBytes?: number
  freeBytes?: number
  projectedFreeBytes?: number
  criticalReserveBytes?: number
}
