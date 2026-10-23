import { randomBytes, randomUUID } from 'node:crypto'
import {
  CloudId,
  type CloudClaim,
  type CloudJob,
  type CloudProject,
  type CloudWorker
} from '../../../shared/cloud-jobs'
import { availableCloudWorkerBytes } from '../../../shared/cloud-worker-enrollment'
import type SyncDatabase from '../../sqlite/sync-database'
import { cloudTransaction } from './database'

const LEASE_MS = 60_000
const SAMPLE_MAX_AGE_MS = 90_000

export type CloudWorkerClaimContext = {
  db: SyncDatabase
  now: () => number
  get: (jobId: string) => CloudJob
  project: (projectId: string) => CloudProject
  save: (job: CloudJob, patch: Partial<CloudJob>, reason: string) => CloudJob
  isDispatchEnabled: () => boolean
  projectRootStillTrusted: (project: CloudProject) => boolean
  persistedQueueReservedBytes: (deviceId: string) => number
  hash: (value: string) => string
  expireLeases: () => void
}

export type CloudWorkerRecipeFloor = {
  projectId: string
  recipeId: string
  minimumWorkingBytes?: number
}

export function claimWorkerJob(
  context: CloudWorkerClaimContext,
  worker: CloudWorker,
  allowedProjectRecipes?: readonly CloudWorkerRecipeFloor[]
): CloudClaim | null {
  CloudId.parse(worker.id)
  CloudId.parse(worker.deviceId)
  return cloudTransaction(context.db, () => {
    context.expireLeases()
    const reservedForDevice = context.persistedQueueReservedBytes(worker.deviceId)
    if (
      !context.isDispatchEnabled() ||
      context.db
        .prepare(
          "SELECT id FROM cloud_attempts WHERE worker=? AND status IN ('running', 'stopping', 'interrupted')"
        )
        .get(worker.id)
    ) {
      return null
    }
    const jobs = context.db
      .prepare(
        "SELECT id FROM cloud_jobs WHERE target=? AND state IN ('queued', 'waiting_for_worker') ORDER BY created_at, id"
      )
      .all(worker.deviceId)
    for (const row of jobs) {
      const job = context.get(String(row.id))
      const project = context.project(job.projectId)
      const assignment = allowedProjectRecipes?.find(
        (entry) => entry.projectId === job.projectId && entry.recipeId === job.recipeId
      )
      let reason: string | null = null
      if (allowedProjectRecipes && !assignment) {
        continue
      }
      const minimumWorkingBytes = assignment?.minimumWorkingBytes ?? 0
      if (!Number.isSafeInteger(minimumWorkingBytes) || minimumWorkingBytes < 0) {
        const reason = 'Worker recipe minimum working space is invalid.'
        if (job.state !== 'waiting_for_worker' || job.waitingReason !== reason) {
          context.save(job, { state: 'waiting_for_worker', waitingReason: reason }, reason)
        }
        continue
      }
      const reservedForJob = Math.max(job.estimatedBytes, minimumWorkingBytes)
      const availableBytes = availableCloudWorkerBytes(worker, reservedForDevice)
      if (
        availableBytes === null ||
        !Number.isSafeInteger(worker.sampledAt) ||
        worker.sampledAt < 0 ||
        worker.sampledAt > context.now() ||
        context.now() - worker.sampledAt > SAMPLE_MAX_AGE_MS
      ) {
        reason = 'Storage reading is stale or invalid.'
      } else if (!worker.capabilities.includes(project.capability)) {
        reason = 'Worker capability does not match.'
      } else if (project.deviceId !== worker.deviceId || !project.recipes.includes(job.recipeId)) {
        reason = 'Project target or recipe changed.'
      } else if (job.dependencies.some((id) => context.get(id).state !== 'completed')) {
        reason = 'Waiting for verified dependency.'
      } else if (reservedForJob > availableBytes) {
        reason = 'Insufficient storage headroom.'
      } else if (!context.projectRootStillTrusted(project)) {
        reason = 'Project root changed or lacks fresh authenticated device authority.'
      }
      if (reason) {
        if (job.state !== 'waiting_for_worker' || job.waitingReason !== reason) {
          context.save(job, { state: 'waiting_for_worker', waitingReason: reason }, reason)
        }
        continue
      }
      const token = randomBytes(32).toString('hex')
      const attemptId = randomUUID()
      const expiry = context.now() + LEASE_MS
      context.db
        .prepare('INSERT INTO cloud_attempts VALUES (?, ?, ?, ?, ?, ?, ?, NULL)')
        .run(attemptId, job.id, worker.id, context.hash(token), expiry, 'running', context.now())
      context.db
        .prepare(
          'INSERT INTO cloud_capacity_reservations(job_id, device_id, bytes, created_at) VALUES (?, ?, ?, ?)'
        )
        .run(job.id, worker.deviceId, reservedForJob, context.now())
      const claimed = context.save(
        job,
        { state: 'running', waitingReason: null, attemptCount: job.attemptCount + 1 },
        'Worker claimed'
      )
      return { job: claimed, attemptId, leaseToken: token, leaseExpiresAt: expiry }
    }
    return null
  })
}
