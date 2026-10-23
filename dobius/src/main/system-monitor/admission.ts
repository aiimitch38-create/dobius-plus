import type { StorageAdmissionDecision, StorageFreshness } from '../../shared/system-monitor'
import type {
  SystemMonitorAdmissionRequest,
  SystemMonitorRegistration,
  SystemMonitorSnapshotResult
} from './adapter'

function denied(
  rootId: string,
  freshness: StorageFreshness,
  reason: StorageAdmissionDecision['reason']
): StorageAdmissionDecision {
  return { schemaVersion: 1, allowed: false, reason, rootId, freshness }
}

/** Pure admission view only. Reservation creation and fencing remain outside C04. */
export function evaluateSystemMonitorAdmission(
  result: SystemMonitorSnapshotResult,
  registration: SystemMonitorRegistration,
  request: SystemMonitorAdmissionRequest
): StorageAdmissionDecision {
  if (result.availability !== 'available' || result.freshness !== 'fresh') {
    return denied(request.rootId, result.freshness, result.freshness)
  }
  const expected = registration.roots.find((root) => root.id === request.rootId)
  const root = result.roots.find((candidate) => candidate.id === request.rootId)
  if (!expected || !root || root.state !== 'available') {
    return denied(request.rootId, 'fresh', 'root_unavailable')
  }
  if (
    root.path !== expected.path ||
    root.identity.device !== expected.device ||
    root.identity.inode !== expected.inode
  ) {
    return denied(request.rootId, 'fresh', 'root_identity_changed')
  }
  const volume = result.volumes.find((candidate) => candidate.id === root.volumeId)
  if (!volume || volume.totalBytes <= 0 || volume.freeBytes > volume.totalBytes) {
    return denied(request.rootId, 'fresh', 'volume_unavailable')
  }
  if (
    !Number.isSafeInteger(request.reservedBytes) ||
    request.reservedBytes < 0 ||
    (request.estimateBytes !== null &&
      (!Number.isSafeInteger(request.estimateBytes) || request.estimateBytes < 0))
  ) {
    return denied(request.rootId, 'fresh', 'invalid_space_estimate')
  }
  const estimate = request.estimateBytes ?? registration.policy.unknownEstimateBytes
  const required = estimate + request.reservedBytes + registration.policy.safetyMarginBytes
  if (!Number.isSafeInteger(required)) {
    return denied(request.rootId, 'fresh', 'invalid_space_estimate')
  }
  const criticalReserve = Math.max(
    registration.policy.criticalBytes,
    Math.ceil(volume.totalBytes * registration.policy.criticalFraction)
  )
  const projected = volume.freeBytes - required
  const allowed = volume.state !== 'critical' && projected >= criticalReserve
  return {
    schemaVersion: 1,
    allowed,
    reason: allowed ? 'admitted' : 'insufficient_space',
    rootId: request.rootId,
    freshness: 'fresh',
    volumeId: volume.id,
    estimatedWorkingBytes: estimate,
    estimateSource: request.estimateBytes === null ? 'unknown_policy' : 'job',
    reservedBytes: request.reservedBytes,
    safetyMarginBytes: registration.policy.safetyMarginBytes,
    requiredBytes: required,
    freeBytes: volume.freeBytes,
    projectedFreeBytes: projected,
    criticalReserveBytes: criticalReserve
  }
}
