import {
  CloudJobAdamBindingIdentity,
  CloudJobAdamBindingResponse
} from '../../../shared/cloud-job-adam-receipts'
import type { CloudJobAdamUnavailableReason } from './cloud-job-adam-transport'
import type SyncDatabase from '../../sqlite/sync-database'
import {
  CloudJobAdamOutboxFailure,
  CloudJobAdamOutboxNow,
  type CloudJobAdamOutboxFailure as Failure
} from './cloud-job-adam-outbox-schema'

export const drainerIntervalMs = CloudJobAdamOutboxNow.min(100).max(60_000)
export const drainerStopWaitMs = CloudJobAdamOutboxNow.min(0).max(30_000)

export type CloudJobAdamDrainerOptions = {
  owner: string
  now: () => number
  authorityAvailable: () => boolean
  leaseMs?: number
  intervalMs?: number
  maxBatch?: number
}

export type CloudJobAdamDrainerTick = {
  state: 'completed' | 'failed' | 'not-running'
  acknowledged: number
  retried: number
  blocked: number
  retained: number
}

export type CloudJobAdamDrainerStop = 'drained' | 'timed-out'

export function emptyTick(state: CloudJobAdamDrainerTick['state']): CloudJobAdamDrainerTick {
  return { state, acknowledged: 0, retried: 0, blocked: 0, retained: 0 }
}

export function readConsumedBinding(db: SyncDatabase, bindingId: string, jobId: string) {
  try {
    const row = db
      .prepare('SELECT * FROM cloud_job_adam_bindings WHERE binding_id=? AND job_id=?')
      .get(bindingId, jobId)
    if (!row) {
      return null
    }
    const binding = CloudJobAdamBindingIdentity.parse({
      schemaVersion: 1,
      bindingId: row.binding_id,
      adamInstanceId: row.adam_instance_id,
      parentObjectiveId: row.parent_objective_id,
      parentObjectiveVersion: Number(row.parent_objective_version),
      projectId: row.project_id,
      contextDigest: row.context_digest,
      requestFingerprint: row.request_fingerprint,
      expiresAtMs: Number(row.expires_at_ms)
    })
    return CloudJobAdamBindingResponse.parse({
      schemaVersion: 1,
      consumed: true,
      binding,
      boundAtMs: Number(row.bound_at_ms),
      bindingDigest: row.binding_digest
    })
  } catch {
    return null
  }
}

export function mapUnavailable(reason: CloudJobAdamUnavailableReason): Failure | 'retain' {
  switch (reason) {
    case 'timeout':
    case 'transport-error':
      return 'retain'
    case 'endpoint-blocked':
    case 'endpoint-changed':
      return 'endpoint-changed'
    case 'auth-unavailable':
      return 'auth-unavailable'
    case 'unauthorized':
      return 'unauthorized'
    case 'unsupported':
      return 'unsupported'
    case 'remote-error':
      return 'remote-error'
    case 'malformed-response':
    case 'receipt-binding-mismatch':
    case 'receipt-ack-mismatch':
      return 'malformed-response'
    case 'request-too-large':
    case 'response-too-large':
    case 'expired-binding':
      return 'unsupported'
    case 'busy':
      return 'transport-error'
  }
}

export function parseFailure(reason: Failure): Failure {
  return CloudJobAdamOutboxFailure.parse(reason)
}
