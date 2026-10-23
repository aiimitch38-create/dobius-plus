import {
  WorkerJob,
  WorkerLeaseReceipt,
  type QueuePort,
  type WorkerClaim
} from '../../../shared/workstation-worker'
import type { WorkstationWorker } from '../workstation-worker/worker'

export type CloudWorkerRuntimeAuthority = { ready: boolean; dispatchEnabled: boolean }
export type CloudWorkerLeaseRead =
  | { kind: 'idle' }
  | { kind: 'active'; lease: unknown }
  | { kind: 'unknown' }
export type CloudWorkerCancellationRead =
  | { kind: 'stopping'; lease: unknown }
  | { kind: 'not-stopping'; lease: unknown }
  | { kind: 'unknown' }
export type CloudWorkerUnstartedCancellation =
  | { confirmed: true; attemptId: string; workerId: string; token: string }
  | { confirmed: false }
export type CloudWorkerRuntimeSlot = {
  profileId: 'hermes-1' | 'hermes-2'
  workerId: string
  worker: Pick<WorkstationWorker, 'runClaim' | 'reconcile' | 'cancel'>
  queue: Pick<QueuePort, 'claim'>
}
export type CloudWorkerRuntimeOptions = {
  slots: readonly CloudWorkerRuntimeSlot[]
  /** Synchronous server-owned readiness and dispatch state. */
  readAuthority: () => CloudWorkerRuntimeAuthority
  /** Returns this enrolled worker's durable active lease, or explicit idle. */
  readActiveLease: (workerId: string) => Promise<CloudWorkerLeaseRead>
  /** Unknown or mismatched observations never grant cancellation or dispatch authority. */
  observeCancellation: (
    lease: ReturnType<typeof WorkerLeaseReceipt.parse>
  ) => Promise<CloudWorkerCancellationRead>
  /** Durable compare-and-cancel; confirms only claims with no start permit/process receipt. */
  cancelUnstartedClaim: (claim: WorkerClaim) => Promise<CloudWorkerUnstartedCancellation>
  /** Persists a shutdown stop request for this exact active lease; it never signals a process. */
  requestActiveCancellation: (
    lease: ReturnType<typeof WorkerLeaseReceipt.parse>
  ) => Promise<
    { confirmed: true; attemptId: string; workerId: string; token: string } | { confirmed: false }
  >
}

export type ActiveAttempt = {
  lease: ReturnType<typeof WorkerLeaseReceipt.parse>
  claim?: WorkerClaim
  runTask: Promise<void> | null
  cancelTask: Promise<unknown> | null
  outcome: 'running' | 'resolved' | 'rejected'
  started: boolean
  cancellationUncertain: boolean
}
export type SlotState =
  | { kind: 'unrecovered' }
  | { kind: 'idle' }
  | { kind: 'active'; attempt: ActiveAttempt }
  | { kind: 'ambiguous'; reason: string; retryRecovery?: true; claim?: WorkerClaim }
export type RuntimeSlotState = { config: CloudWorkerRuntimeSlot; state: SlotState }
export type CloudWorkerRuntimeSnapshotSlot = {
  profileId: 'hermes-1' | 'hermes-2'
  workerId: string
  state: SlotState['kind']
  reason?: string
  attemptId?: string
}

export const PROFILE_IDS = ['hermes-1', 'hermes-2'] as const

export function parseAuthority(read: () => CloudWorkerRuntimeAuthority) {
  const value = read()
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.ready !== 'boolean' ||
    typeof value.dispatchEnabled !== 'boolean'
  ) {
    throw new Error('Worker readiness authority is malformed.')
  }
  return value
}

export function leaseForClaim(claim: WorkerClaim) {
  const job = WorkerJob.parse(claim.job)
  const lease = WorkerLeaseReceipt.parse({
    attemptId: claim.attemptId,
    workerId: claim.workerId,
    token: claim.token,
    expiresAt: claim.expiresAt
  })
  if (job.attemptId !== lease.attemptId || claim.attemptId !== job.attemptId) {
    throw new Error('Claim job and durable lease attempt identities differ.')
  }
  return { job, lease }
}

export function sameLease(left: unknown, right: ReturnType<typeof WorkerLeaseReceipt.parse>) {
  try {
    const parsed = WorkerLeaseReceipt.parse(left)
    return (
      parsed.attemptId === right.attemptId &&
      parsed.workerId === right.workerId &&
      parsed.token === right.token
    )
  } catch {
    return false
  }
}

export function confirmedFor(
  value: { confirmed: boolean; attemptId?: string; workerId?: string; token?: string },
  lease: ReturnType<typeof WorkerLeaseReceipt.parse>
) {
  return (
    value.confirmed === true &&
    value.attemptId === lease.attemptId &&
    value.workerId === lease.workerId &&
    value.token === lease.token
  )
}
