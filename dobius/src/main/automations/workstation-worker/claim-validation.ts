import { WorkerJob, WorkerLeaseReceipt } from '../../../shared/workstation-worker'

export function validateWorkerClaim(input: unknown, workerId: string, now: number) {
  const envelope = input as {
    job?: unknown
    attemptId?: unknown
    workerId?: unknown
    token?: unknown
    expiresAt?: unknown
  }
  const job = WorkerJob.parse(envelope.job)
  const lease = WorkerLeaseReceipt.parse({
    attemptId: envelope.attemptId,
    workerId: envelope.workerId,
    token: envelope.token,
    expiresAt: envelope.expiresAt
  })
  if (lease.attemptId !== job.attemptId || lease.workerId !== workerId) {
    throw new Error('Lease and enrolled worker identity do not match job.')
  }
  if (lease.expiresAt <= now) {
    throw new Error('Lease is expired before local launch.')
  }
  return { job, lease }
}
