import { lstatSync } from 'node:fs'
import { isAbsolute, join, normalize } from 'node:path'
import type {
  MonitoredRootStatus,
  MonitoredVolumeStatus,
  StorageFreshness,
  StorageHealth,
  SystemMonitorConfig,
  SystemMonitorStatus
} from '../../shared/system-monitor'
import {
  systemMonitorRegistrationSchema,
  systemMonitorStatusSchema,
  type RuntimeSystemMonitorStatus
} from './status-schema'
import { PrivateJsonError, readBoundedPrivateJson } from './private-json'

const MAX_CLOCK_SKEW_MS = 5_000

export type SystemMonitorRegistration = Pick<SystemMonitorConfig, 'deviceId' | 'roots' | 'policy'>

export type SystemMonitorSnapshotResult =
  | {
      availability: 'available'
      health: StorageHealth
      freshness: StorageFreshness
      sampledAtMs: number
      ageMs: number
      roots: MonitoredRootStatus[]
      volumes: MonitoredVolumeStatus[]
      snapshot: SystemMonitorStatus
    }
  | {
      availability: 'unavailable'
      health: 'unavailable'
      freshness: 'unavailable' | 'clock_skew'
      reason:
        | 'missing'
        | 'invalid'
        | 'untrusted_file'
        | 'identity_mismatch'
        | 'clock_skew'
        | 'unsupported_platform'
      sampledAtMs: null
      ageMs: null
      roots: []
      volumes: []
      snapshot: null
    }

export type SystemMonitorAdmissionRequest = {
  rootId: string
  estimateBytes: number | null
  /** Must come from the existing atomic reservation owner; this module never reserves. */
  reservedBytes: number
}

export { evaluateSystemMonitorAdmission } from './admission'

function unavailable(
  reason: Extract<SystemMonitorSnapshotResult, { availability: 'unavailable' }>['reason']
): SystemMonitorSnapshotResult {
  return {
    availability: 'unavailable',
    health: 'unavailable',
    freshness: reason === 'clock_skew' ? 'clock_skew' : 'unavailable',
    reason,
    sampledAtMs: null,
    ageMs: null,
    roots: [],
    volumes: [],
    snapshot: null
  }
}

function registrationMatches(
  snapshot: RuntimeSystemMonitorStatus,
  registration: SystemMonitorRegistration
): boolean {
  if (snapshot.deviceId !== registration.deviceId) {
    return false
  }
  if (snapshot.freshnessSeconds !== registration.policy.freshnessSeconds) {
    return false
  }
  if (snapshot.roots.length !== registration.roots.length) {
    return false
  }
  const seen = new Set<string>()
  for (const root of snapshot.roots) {
    const expected = registration.roots.find((candidate) => candidate.id === root.id)
    if (
      !expected ||
      seen.has(root.id) ||
      root.path !== expected.path ||
      root.identity.device !== expected.device ||
      root.identity.inode !== expected.inode ||
      (root.volumeId !== null && root.volumeId !== String(expected.device))
    ) {
      return false
    }
    try {
      const current = lstatSync(expected.path)
      if (
        current.isSymbolicLink() ||
        !current.isDirectory() ||
        current.dev !== expected.device ||
        current.ino !== expected.inode
      ) {
        return false
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || root.state !== 'unavailable') {
        return false
      }
    }
    seen.add(root.id)
  }
  return seen.size === registration.roots.length
}

function derivedHealth(snapshot: RuntimeSystemMonitorStatus): StorageHealth {
  if (snapshot.roots.length === 0) {
    return 'unconfigured'
  }
  if (snapshot.roots.some((root) => root.state === 'unavailable')) {
    return 'unavailable'
  }
  if (snapshot.volumes.some((volume) => volume.state === 'critical')) {
    return 'critical'
  }
  if (snapshot.volumes.some((volume) => volume.state === 'warning')) {
    return 'warning'
  }
  return 'healthy'
}

/** Reads one bounded private status snapshot; freshness is always recomputed locally. */
export function loadSystemMonitorSnapshot(
  stateDirectory: string,
  registration: SystemMonitorRegistration,
  nowMs = Date.now()
): SystemMonitorSnapshotResult {
  if (process.platform === 'win32') {
    return unavailable('unsupported_platform')
  }
  if (
    !isAbsolute(stateDirectory) ||
    normalize(stateDirectory) !== stateDirectory ||
    !Number.isFinite(nowMs)
  ) {
    return unavailable('invalid')
  }
  const registrationResult = systemMonitorRegistrationSchema.safeParse(registration)
  if (!registrationResult.success) {
    return unavailable('invalid')
  }
  const registeredIds = new Set<string>()
  for (const root of registrationResult.data.roots) {
    if (
      !isAbsolute(root.path) ||
      normalize(root.path) !== root.path ||
      registeredIds.has(root.id)
    ) {
      return unavailable('invalid')
    }
    registeredIds.add(root.id)
  }
  let raw: unknown
  try {
    raw = readBoundedPrivateJson(join(stateDirectory, 'status.json'))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (error instanceof PrivateJsonError) {
      return unavailable(error.reason)
    }
    return unavailable(
      code === 'ENOENT'
        ? 'missing'
        : code === 'EACCES' || code === 'EPERM'
          ? 'untrusted_file'
          : 'invalid'
    )
  }
  const parsed = systemMonitorStatusSchema.safeParse(raw)
  if (!parsed.success) {
    return unavailable('invalid')
  }
  const snapshot = parsed.data
  if (!registrationMatches(snapshot, registrationResult.data)) {
    return unavailable('identity_mismatch')
  }

  // The producer emits Unix seconds; convert once and compare in milliseconds.
  const sampledAtMs = snapshot.sampledAt * 1000
  const ageMs = nowMs - sampledAtMs
  if (ageMs < -MAX_CLOCK_SKEW_MS) {
    return unavailable('clock_skew')
  }
  const freshness: StorageFreshness = ageMs <= snapshot.freshnessSeconds * 1000 ? 'fresh' : 'stale'
  return {
    availability: 'available',
    health: derivedHealth(snapshot),
    freshness,
    sampledAtMs,
    ageMs,
    roots: snapshot.roots,
    volumes: snapshot.volumes,
    snapshot
  }
}
