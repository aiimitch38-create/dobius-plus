import { randomUUID } from 'node:crypto'
import {
  CloudWorkerCapacitySample,
  CloudWorkerEnrollment,
  CloudWorkerStartBinding,
  type CloudWorkerCapacitySample as CapacitySample,
  type CloudWorkerEnrollment as Enrollment
} from '../../../shared/cloud-worker-enrollment'
import {
  WorkerLeaseReceipt,
  WorkerStartPermit,
  type QueuePort
} from '../../../shared/workstation-worker'
import type { CloudJobStore } from './store'

const START_PERMIT_TTL_MS = 15_000

export type CloudWorkerQueuePortOptions = {
  store: CloudJobStore
  /** Enrollment is parsed once at construction and must come from trusted local policy. */
  enrollment: unknown
  /** Reads authenticated device telemetry; externalReservedBytes excludes queue-owned bytes. */
  readCapacity: (deviceId: string) => CapacitySample
  now?: () => number
}

/** In-process adapter only. It exposes no RPC and trusts only constructor-owned enrollment. */
export class CloudWorkerQueuePort implements QueuePort {
  private readonly enrollment: Enrollment
  private readonly now: () => number

  constructor(private readonly options: CloudWorkerQueuePortOptions) {
    this.enrollment = CloudWorkerEnrollment.parse(options.enrollment)
    this.now = options.now ?? Date.now
  }

  async claim(workerId: string) {
    if (workerId !== this.enrollment.workerId) {
      throw new Error('Claim worker identity does not match this enrolled adapter.')
    }
    const capacity = CloudWorkerCapacitySample.parse(
      this.options.readCapacity(this.enrollment.deviceId)
    )
    const claim = this.options.store.claim(
      {
        id: this.enrollment.workerId,
        deviceId: this.enrollment.deviceId,
        capabilities: [...this.enrollment.capabilities],
        ...capacity
      },
      this.enrollment.assignments.map(({ projectId, recipeId, minimumWorkingBytes }) => ({
        projectId,
        recipeId,
        minimumWorkingBytes
      }))
    )
    if (!claim) {
      return null
    }
    const assignment = this.assignmentFor(claim.job.projectId, claim.job.recipeId)
    return {
      job: {
        id: claim.job.id,
        attemptId: claim.attemptId,
        deviceId: this.enrollment.deviceId,
        recipeId: assignment.recipeId,
        rootId: assignment.rootId,
        sourceRevision: claim.job.sourceRevision,
        profileId: assignment.profileId,
        worktreeId: assignment.worktreeId,
        caps: assignment.caps
      },
      attemptId: claim.attemptId,
      workerId: this.enrollment.workerId,
      token: claim.leaseToken,
      expiresAt: claim.leaseExpiresAt
    }
  }

  async authorizeStart(leaseInput: unknown, bindingInput: unknown) {
    const lease = WorkerLeaseReceipt.parse(leaseInput)
    const binding = CloudWorkerStartBinding.parse(bindingInput)
    this.assertLeaseWorker(lease)
    const job = this.options.store.getWorkerAttemptJob(lease)
    const project = this.options.store.project(job.projectId)
    const assignment = this.assignmentFor(job.projectId, job.recipeId)
    if (
      binding.attemptId !== lease.attemptId ||
      binding.workerId !== lease.workerId ||
      binding.deviceId !== this.enrollment.deviceId ||
      binding.recipeId !== job.recipeId ||
      !this.enrollment.capabilities.includes(project.capability) ||
      binding.sourceRevision !== job.sourceRevision ||
      binding.profileId !== assignment.profileId ||
      binding.rootId !== assignment.rootId ||
      binding.worktreeId !== assignment.worktreeId ||
      JSON.stringify(binding.caps) !== JSON.stringify(assignment.caps)
    ) {
      throw new Error('Requested start binding does not match enrolled job policy.')
    }
    if (!this.options.store.projectRootIsFresh(job.projectId, this.enrollment.deviceId)) {
      throw new Error('Project root authority is missing, expired, or changed.')
    }
    const capacity = CloudWorkerCapacitySample.parse(
      this.options.readCapacity(this.enrollment.deviceId)
    )
    const proposed = WorkerStartPermit.parse({
      ...binding,
      permitId: randomUUID(),
      expiresAt: Math.min(lease.expiresAt, this.now() + START_PERMIT_TTL_MS)
    })
    return this.options.store.authorizeWorkerStart({
      attemptId: lease.attemptId,
      workerId: lease.workerId,
      token: lease.token,
      deviceId: this.enrollment.deviceId,
      projectId: job.projectId,
      minimumWorkingBytes: assignment.minimumWorkingBytes,
      bindingInput: binding,
      permitInput: proposed,
      capacityInput: capacity
    })
  }

  async acknowledgeStarted(leaseInput: unknown, identity: unknown): Promise<void> {
    const lease = WorkerLeaseReceipt.parse(leaseInput)
    this.assertLeaseWorker(lease)
    const permit = this.options.store.getWorkerPermit(lease)
    this.options.store.acknowledgeWorkerStarted({
      attemptId: lease.attemptId,
      workerId: lease.workerId,
      token: lease.token,
      permitId: permit.permitId,
      identityInput: identity
    })
  }

  async reconcile(
    leaseInput: unknown,
    identity: unknown
  ): Promise<'owned' | 'stopping' | 'unknown'> {
    const lease = WorkerLeaseReceipt.parse(leaseInput)
    this.assertLeaseWorker(lease)
    return this.options.store.reconcileWorkerAttempt({
      attemptId: lease.attemptId,
      workerId: lease.workerId,
      token: lease.token,
      identityInput: identity
    })
  }

  async heartbeat(leaseInput: unknown, progress: { outputBytes: number; logCursor: number }) {
    const lease = WorkerLeaseReceipt.parse(leaseInput)
    this.assertLeaseWorker(lease)
    const expiresAt = this.options.store.heartbeatWorkerAttempt({
      attemptId: lease.attemptId,
      workerId: lease.workerId,
      token: lease.token,
      outputBytes: progress.outputBytes,
      logCursor: progress.logCursor
    })
    return { ...lease, expiresAt }
  }

  async settle(
    leaseInput: unknown,
    result: { succeeded: boolean; exitCode: number | null; evidence: string[] }
  ): Promise<void> {
    const lease = WorkerLeaseReceipt.parse(leaseInput)
    this.assertLeaseWorker(lease)
    if (result.succeeded && result.exitCode !== 0) {
      throw new Error('Successful worker result requires a zero exit code.')
    }
    this.options.store.settleWorkerAttempt({
      attemptId: lease.attemptId,
      workerId: lease.workerId,
      token: lease.token,
      ...result
    })
  }

  async acknowledgeStopped(
    leaseInput: unknown,
    receipt: Parameters<QueuePort['acknowledgeStopped']>[1]
  ): Promise<void> {
    const lease = WorkerLeaseReceipt.parse(leaseInput)
    this.assertLeaseWorker(lease)
    const record = this.options.store.getWorkerStartRecord(
      lease.attemptId,
      lease.workerId,
      lease.token
    )
    if (
      receipt.attemptId !== lease.attemptId ||
      receipt.workerId !== lease.workerId ||
      receipt.processGroupId !== record.identity.processGroupId ||
      receipt.containment !== 'posix-process-group' ||
      receipt.descendantsAbsent !== true
    ) {
      throw new Error('C05 stop receipt does not identify the enrolled attempt process group.')
    }
    this.options.store.acknowledgeStopped(lease.attemptId, lease.workerId, lease.token, {
      ...receipt,
      identity: record.identity,
      bindingSha256: record.bindingHash
    })
  }

  private assignmentFor(projectId: string, recipeId: string) {
    const assignment = this.enrollment.assignments.find(
      (candidate) => candidate.projectId === projectId && candidate.recipeId === recipeId
    )
    if (!assignment) {
      throw new Error('Claimed project/recipe has no unique server-approved worker assignment.')
    }
    return assignment
  }

  private assertLeaseWorker(lease: { workerId: string }) {
    if (lease.workerId !== this.enrollment.workerId) {
      throw new Error('Lease worker does not match this enrolled adapter.')
    }
  }
}
