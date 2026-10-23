import { createHash } from 'node:crypto'
import type SyncDatabase from '../../sqlite/sync-database'
import type { CloudJob, CloudProject } from '../../../shared/cloud-jobs'
import { availableCloudWorkerBytes } from '../../../shared/cloud-worker-enrollment'
import {
  CloudWorkerCapacitySample,
  CloudWorkerProcessIdentity,
  CloudWorkerStartBinding,
  type CloudWorkerProcessIdentity as WorkerProcessIdentity
} from '../../../shared/cloud-worker-enrollment'
import {
  WorkerStartPermit,
  type WorkerStartPermit as StartPermit
} from '../../../shared/workstation-worker'

const SAMPLE_MAX_AGE_MS = 90_000
const START_PERMIT_MAX_AGE_MS = 30_000
const hash = (value: string) => createHash('sha256').update(value).digest('hex')

export type CloudWorkerLedgerContext = {
  db: SyncDatabase
  now: () => number
  lease: (attemptId: string, workerId: string, token: string) => CloudJob
  project: (projectId: string) => CloudProject
  projectRootStillTrusted: (project: CloudProject) => boolean
  get: (jobId: string) => CloudJob
  save: (job: CloudJob, patch: Partial<CloudJob>, reason: string) => CloudJob
  expireLeases: () => void
}

export function authorizeWorkerStart(
  context: CloudWorkerLedgerContext,
  args: {
    attemptId: string
    workerId: string
    token: string
    deviceId: string
    projectId: string
    minimumWorkingBytes: number
    bindingInput: unknown
    permitInput: unknown
    capacityInput: unknown
  }
): StartPermit {
  const binding = CloudWorkerStartBinding.parse(args.bindingInput)
  const proposed = WorkerStartPermit.parse(args.permitInput)
  const capacity = CloudWorkerCapacitySample.parse(args.capacityInput)
  return immediate(context.db, () => {
    const job = context.lease(args.attemptId, args.workerId, args.token)
    const attempt = context.db
      .prepare('SELECT * FROM cloud_attempts WHERE id=?')
      .get(args.attemptId)
    const project = context.project(job.projectId)
    const reservation = context.db
      .prepare('SELECT device_id, bytes FROM cloud_capacity_reservations WHERE job_id=?')
      .get(job.id)
    const bindingHash = hash(JSON.stringify({ jobId: job.id, projectId: job.projectId, binding }))
    const now = context.now()
    const queueReserved = persistedQueueReservedBytes(context.db, args.deviceId)
    const available = availableCloudWorkerBytes(capacity, queueReserved)
    const expectedReservation = Math.max(job.estimatedBytes, args.minimumWorkingBytes)
    if (
      !attempt ||
      attempt.worker !== args.workerId ||
      project.deviceId !== args.deviceId ||
      project.deviceId !== job.targetDeviceId ||
      !project.recipes.includes(job.recipeId) ||
      binding.attemptId !== args.attemptId ||
      binding.workerId !== args.workerId ||
      binding.deviceId !== args.deviceId ||
      binding.recipeId !== job.recipeId ||
      binding.sourceRevision !== job.sourceRevision ||
      !reservation ||
      reservation.device_id !== args.deviceId ||
      !Number.isSafeInteger(args.minimumWorkingBytes) ||
      args.minimumWorkingBytes < 0 ||
      Number(reservation.bytes) !== expectedReservation ||
      capacity.sampledAt > now ||
      now - capacity.sampledAt > SAMPLE_MAX_AGE_MS ||
      available === null ||
      available < 0 ||
      !context.projectRootStillTrusted(project) ||
      proposed.attemptId !== binding.attemptId ||
      proposed.workerId !== binding.workerId ||
      proposed.deviceId !== binding.deviceId ||
      proposed.profileId !== binding.profileId ||
      proposed.rootId !== binding.rootId ||
      proposed.worktreeId !== binding.worktreeId ||
      proposed.recipeId !== binding.recipeId ||
      proposed.sourceRevision !== binding.sourceRevision ||
      JSON.stringify(proposed.caps) !== JSON.stringify(binding.caps) ||
      proposed.expiresAt <= now ||
      proposed.expiresAt > Number(attempt.expires_at) ||
      proposed.expiresAt > now + START_PERMIT_MAX_AGE_MS
    ) {
      throw new Error('Worker start permit authority, binding, capacity, or reservation is stale.')
    }
    const persisted = context.db
      .prepare('SELECT * FROM cloud_worker_permits WHERE attempt_id=?')
      .get(args.attemptId)
    if (persisted) {
      if (
        persisted.worker !== args.workerId ||
        persisted.device_id !== args.deviceId ||
        persisted.project_id !== job.projectId ||
        persisted.job_id !== job.id ||
        persisted.binding_hash !== bindingHash ||
        Number(persisted.expires_at) <= now ||
        persisted.consumed_at !== null
      ) {
        throw new Error('A different, expired, or already consumed start permit owns this attempt.')
      }
      return WorkerStartPermit.parse({
        ...binding,
        permitId: persisted.permit_id,
        expiresAt: Number(persisted.expires_at)
      })
    }
    context.db
      .prepare(
        `INSERT INTO cloud_worker_permits
         (attempt_id, permit_id, worker, device_id, project_id, job_id, binding_json, binding_hash, expires_at, consumed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
      )
      .run(
        args.attemptId,
        proposed.permitId,
        args.workerId,
        args.deviceId,
        job.projectId,
        job.id,
        JSON.stringify(binding),
        bindingHash,
        proposed.expiresAt
      )
    return proposed
  })
}

export function acknowledgeWorkerStarted(
  context: CloudWorkerLedgerContext,
  args: {
    attemptId: string
    workerId: string
    token: string
    permitId: string
    identityInput: unknown
  }
): void {
  const identity = CloudWorkerProcessIdentity.parse(args.identityInput)
  immediate(context.db, () => {
    const attempt = context.db
      .prepare('SELECT * FROM cloud_attempts WHERE id=?')
      .get(args.attemptId)
    if (!attempt || attempt.worker !== args.workerId || attempt.lease_hash !== hash(args.token)) {
      throw new Error('Started-process receipt lease does not own this attempt.')
    }
    const existing = context.db
      .prepare('SELECT * FROM cloud_worker_starts WHERE attempt_id=?')
      .get(args.attemptId)
    if (existing) {
      if (existing.permit_id !== args.permitId || !sameProcessIdentity(existing, identity)) {
        throw new Error('Started process identity is already bound to another process.')
      }
      return
    }
    const job = context.lease(args.attemptId, args.workerId, args.token)
    const permit = context.db
      .prepare('SELECT * FROM cloud_worker_permits WHERE attempt_id=?')
      .get(args.attemptId)
    if (
      !permit ||
      permit.worker !== args.workerId ||
      permit.permit_id !== args.permitId ||
      Number(permit.expires_at) <= context.now() ||
      job.id !== permit.job_id
    ) {
      throw new Error('Started process does not have the current durable start permit.')
    }
    if (permit.consumed_at !== null) {
      throw new Error('Start permit was already consumed without a matching start receipt.')
    }
    context.db
      .prepare('UPDATE cloud_worker_permits SET consumed_at=? WHERE attempt_id=?')
      .run(context.now(), args.attemptId)
    context.db
      .prepare(
        `INSERT INTO cloud_worker_starts
         (attempt_id, permit_id, worker, device_id, pid, process_start, process_group_id,
          boot_id, incarnation, started_at, heartbeat_output_bytes, heartbeat_log_cursor,
          heartbeat_at, stop_proof_hash, stop_proof_json, settle_receipt_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, NULL, NULL, NULL)`
      )
      .run(
        args.attemptId,
        args.permitId,
        args.workerId,
        permit.device_id,
        identity.pid,
        identity.processStart,
        identity.processGroupId,
        identity.bootId,
        identity.incarnation,
        context.now()
      )
    // A lease claim precedes process creation; only this committed receipt proves start.
    context.save(job, {}, 'Worker confirmed bound process start receipt')
  })
}

export function sameProcessIdentity(
  row: Record<string, unknown>,
  identity: WorkerProcessIdentity
): boolean {
  return (
    Number(row.pid) === identity.pid &&
    row.process_start === identity.processStart &&
    Number(row.process_group_id) === identity.processGroupId &&
    row.boot_id === identity.bootId &&
    row.incarnation === identity.incarnation
  )
}

function persistedQueueReservedBytes(db: SyncDatabase, deviceId: string): number {
  const rows = db
    .prepare('SELECT bytes FROM cloud_capacity_reservations WHERE device_id=?')
    .all(deviceId)
  let total = 0
  for (const row of rows) {
    const bytes = Number(row.bytes)
    if (!Number.isSafeInteger(bytes) || bytes < 0 || total > Number.MAX_SAFE_INTEGER - bytes) {
      return Number.MAX_SAFE_INTEGER
    }
    total += bytes
  }
  return total
}

function immediate<T>(db: SyncDatabase, action: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = action()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
