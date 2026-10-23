import { createHash } from 'node:crypto'
import type { CloudClaim, CloudJob, CloudWorker } from '../../../shared/cloud-jobs'
import type { WorkerStartPermit as StartPermit } from '../../../shared/workstation-worker'
import { cloudTransaction } from './database'
import {
  readWorkerHostLease,
  observeWorkerHostCancellation,
  cancelWorkerUnstartedClaim,
  requestWorkerHostCancellation
} from './cloud-worker-host-ledger'
import { CloudJobCatalog } from './cloud-job-catalog'
import { claimWorkerJob } from './cloud-worker-claim'
import {
  acknowledgeWorkerStarted,
  authorizeWorkerStart,
  type CloudWorkerLedgerContext
} from './cloud-worker-start-ledger'
import {
  getWorkerAttemptJob,
  getWorkerPermit,
  getWorkerStartRecord,
  projectRootIsFresh as workerProjectRootIsFresh
} from './cloud-worker-ledger-read'
import {
  acknowledgeWorkerStopped,
  heartbeat,
  heartbeatWorkerAttempt,
  reconcileWorkerAttempt,
  settle,
  settleWorkerAttempt
} from './cloud-worker-attempt-lifecycle'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

export class CloudJobStore extends CloudJobCatalog {
  claim(
    worker: CloudWorker,
    allowedProjectRecipes?: readonly {
      projectId: string
      recipeId: string
      minimumWorkingBytes?: number
    }[]
  ): CloudClaim | null {
    return claimWorkerJob(
      {
        db: this.db,
        now: () => this.now(),
        get: (jobId) => this.get(jobId),
        project: (projectId) => this.project(projectId),
        save: (job, patch, reason) => this.save(job, patch, reason),
        isDispatchEnabled: () => this.isDispatchEnabled(),
        projectRootStillTrusted: (project) => this.projectRootStillTrusted(project),
        persistedQueueReservedBytes: (deviceId) => this.persistedQueueReservedBytes(deviceId),
        hash,
        expireLeases: () => this.expireLeases()
      },
      worker,
      allowedProjectRecipes
    )
  }

  private lease(attemptId: string, workerId: string, token: string): CloudJob {
    const row = this.db.prepare('SELECT * FROM cloud_attempts WHERE id=?').get(attemptId)
    if (
      !row ||
      row.worker !== workerId ||
      row.lease_hash !== hash(token) ||
      row.status !== 'running' ||
      Number(row.expires_at) <= this.now()
    ) {
      throw new Error('Worker lease expired or no longer owns this attempt.')
    }
    const job = this.get(String(row.job_id))
    if (job.state !== 'running') {
      throw new Error('Job is no longer running.')
    }
    return job
  }

  private persistedQueueReservedBytes(deviceId: string): number {
    const rows = this.db
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

  private workerContext(): CloudWorkerLedgerContext {
    return {
      db: this.db,
      now: () => this.now(),
      lease: (attemptId, workerId, token) => this.lease(attemptId, workerId, token),
      project: (projectId) => this.project(projectId),
      projectRootStillTrusted: (project) => this.projectRootStillTrusted(project),
      get: (jobId) => this.get(jobId),
      save: (job, patch, reason) => this.save(job, patch, reason),
      expireLeases: () => this.expireLeases()
    }
  }

  authorizeWorkerStart(args: Parameters<typeof authorizeWorkerStart>[1]): StartPermit {
    return authorizeWorkerStart(this.workerContext(), args)
  }

  acknowledgeWorkerStarted(args: Parameters<typeof acknowledgeWorkerStarted>[1]): void {
    acknowledgeWorkerStarted(this.workerContext(), args)
  }

  getWorkerAttemptJob(args: Parameters<typeof getWorkerAttemptJob>[1]): CloudJob {
    return getWorkerAttemptJob(this.workerContext(), args)
  }

  getWorkerPermit(args: Parameters<typeof getWorkerPermit>[1]): StartPermit {
    return getWorkerPermit(this.workerContext(), args)
  }

  reconcileWorkerAttempt(args: Parameters<typeof reconcileWorkerAttempt>[1]) {
    return reconcileWorkerAttempt(this.workerContext(), args)
  }

  heartbeatWorkerAttempt(args: Parameters<typeof heartbeatWorkerAttempt>[1]): number {
    return heartbeatWorkerAttempt(this.workerContext(), args)
  }

  settleWorkerAttempt(args: Parameters<typeof settleWorkerAttempt>[1]): CloudJob {
    return settleWorkerAttempt(this.workerContext(), args)
  }

  getWorkerStartRecord(attemptId: string, workerId: string, token: string) {
    return getWorkerStartRecord(this.workerContext(), attemptId, workerId, token)
  }

  acknowledgeStopped(
    attemptId: string,
    workerId: string,
    token: string,
    proofInput: unknown
  ): void {
    acknowledgeWorkerStopped(this.workerContext(), attemptId, workerId, token, proofInput)
  }

  projectRootIsFresh(projectId: string, deviceId: string): boolean {
    return workerProjectRootIsFresh(this.workerContext(), projectId, deviceId)
  }

  readWorkerHostLease(workerId: string, observation: Parameters<typeof readWorkerHostLease>[2]) {
    return readWorkerHostLease(this.workerContext(), workerId, observation)
  }

  observeWorkerHostCancellation(input: unknown) {
    return observeWorkerHostCancellation(this.workerContext(), input)
  }

  cancelWorkerUnstartedClaim(claim: Parameters<typeof cancelWorkerUnstartedClaim>[1]) {
    return cancelWorkerUnstartedClaim(this.workerContext(), claim)
  }

  requestWorkerHostCancellation(input: unknown) {
    return requestWorkerHostCancellation(this.workerContext(), input)
  }

  heartbeat(attemptId: string, workerId: string, token: string): number {
    return heartbeat(this.workerContext(), attemptId, workerId, token)
  }

  settle(
    attemptId: string,
    workerId: string,
    token: string,
    result: { succeeded: boolean; evidence: string[]; outcome: string }
  ): CloudJob {
    return settle(this.workerContext(), attemptId, workerId, token, result)
  }

  cancel(id: string, version: number): CloudJob {
    return cloudTransaction(this.db, () => {
      const job = this.get(id)
      if (job.version !== version) {
        throw new Error('Job changed; refresh before cancelling.')
      }
      if (['completed', 'cancelled'].includes(job.state)) {
        throw new Error('Job is already final.')
      }
      this.db
        .prepare(
          "UPDATE cloud_attempts SET status='stopping', ended_at=? WHERE job_id=? AND status='running'"
        )
        .run(this.now(), id)
      return this.save(
        job,
        { state: 'cancelled' },
        'Cancellation requested; worker must stop owned processes'
      )
    })
  }

  retry(id: string, version: number): CloudJob {
    return cloudTransaction(this.db, () => {
      const job = this.get(id)
      if (job.version !== version || !['failed', 'interrupted'].includes(job.state)) {
        throw new Error('Only the current failed or reconciled interrupted job can be retried.')
      }
      if (
        this.db
          .prepare(
            "SELECT id FROM cloud_attempts WHERE job_id=? AND status IN ('running', 'stopping', 'interrupted')"
          )
          .get(id)
      ) {
        throw new Error('Previous worker processes must be reconciled before retry.')
      }
      return this.save(
        job,
        { state: 'queued', outcome: null, waitingReason: null },
        'Explicit retry'
      )
    })
  }

  accept(id: string, version: number, verification: string): CloudJob {
    if (!verification.trim() || verification.length > 512) {
      throw new Error('Verification receipt is required.')
    }
    return cloudTransaction(this.db, () => {
      const job = this.get(id)
      if (job.version !== version || job.state !== 'needs_review' || !job.evidence.length) {
        throw new Error('Current reviewed execution with evidence is required.')
      }
      return this.save(
        job,
        { state: 'completed', evidence: [...job.evidence, verification] },
        'Reviewer accepted'
      )
    })
  }

  reconcileExpired(): void {
    cloudTransaction(this.db, () => this.expireLeases())
  }

  private expireLeases(): void {
    const expired = this.db
      .prepare("SELECT id, job_id FROM cloud_attempts WHERE status='running' AND expires_at<=?")
      .all(this.now())
    for (const row of expired) {
      this.db
        .prepare("UPDATE cloud_attempts SET status='interrupted', ended_at=? WHERE id=?")
        .run(this.now(), row.id)
      this.save(
        this.get(String(row.job_id)),
        { state: 'interrupted', outcome: 'Lease lost; reconcile owned process before retry.' },
        'Worker lease expired'
      )
    }
  }
}
