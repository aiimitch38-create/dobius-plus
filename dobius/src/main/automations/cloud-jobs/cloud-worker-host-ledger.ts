import { createHash } from 'node:crypto'
import {
  WorkerJob,
  WorkerLeaseReceipt,
  type WorkerClaim,
  type WorkerLease
} from '../../../shared/workstation-worker'
import type { WorkerJournalLeaseObservation } from '../workstation-worker/lease-observation'
import { cloudTransaction } from './database'
import type { CloudWorkerLedgerContext } from './cloud-worker-start-ledger'

const unresolved = ['running', 'stopping', 'interrupted']
const hash = (token: string) => createHash('sha256').update(token).digest('hex')
const confirmed = (lease: WorkerLease) => ({
  confirmed: true as const,
  attemptId: lease.attemptId,
  workerId: lease.workerId,
  token: lease.token
})

function matchingAttempt(context: CloudWorkerLedgerContext, lease: WorkerLease) {
  const row = context.db.prepare('SELECT * FROM cloud_attempts WHERE id=?').get(lease.attemptId)
  return row &&
    row.worker === lease.workerId &&
    row.lease_hash === hash(lease.token) &&
    unresolved.includes(String(row.status))
    ? row
    : null
}

export function readWorkerHostLease(
  context: CloudWorkerLedgerContext,
  workerId: string,
  observation: WorkerJournalLeaseObservation
) {
  return cloudTransaction(context.db, () => {
    const rows = context.db
      .prepare(
        "SELECT * FROM cloud_attempts WHERE worker=? AND status IN ('running','stopping','interrupted')"
      )
      .all(workerId)
    // Missing journal evidence cannot clear a durable outstanding attempt.
    if (observation.kind === 'unknown') {
      return { kind: 'unknown' as const }
    }
    if (observation.kind !== 'active') {
      return { kind: rows.length === 0 ? ('idle' as const) : ('unknown' as const) }
    }
    const lease = WorkerLeaseReceipt.parse(observation.lease)
    if (lease.workerId !== workerId || rows.length !== 1 || !matchingAttempt(context, lease)) {
      return { kind: 'unknown' as const }
    }
    return { kind: 'active' as const, lease }
  })
}

export function observeWorkerHostCancellation(context: CloudWorkerLedgerContext, input: unknown) {
  const lease = WorkerLeaseReceipt.parse(input)
  return cloudTransaction(context.db, () => {
    const row = matchingAttempt(context, lease)
    if (!row) {
      return { kind: 'unknown' as const }
    }
    return {
      kind:
        row.status === 'running' && Number(row.expires_at) > context.now()
          ? ('not-stopping' as const)
          : ('stopping' as const),
      lease
    }
  })
}

export function cancelWorkerUnstartedClaim(context: CloudWorkerLedgerContext, claim: WorkerClaim) {
  const jobBinding = WorkerJob.parse(claim.job)
  const lease = WorkerLeaseReceipt.parse({
    attemptId: claim.attemptId,
    workerId: claim.workerId,
    token: claim.token,
    expiresAt: claim.expiresAt
  })
  return cloudTransaction(context.db, () => {
    const row = matchingAttempt(context, lease)
    if (!row || jobBinding.attemptId !== lease.attemptId || row.job_id !== jobBinding.id) {
      return { confirmed: false as const }
    }
    const permit = context.db
      .prepare('SELECT attempt_id FROM cloud_worker_permits WHERE attempt_id=?')
      .get(lease.attemptId)
    const started = context.db
      .prepare('SELECT attempt_id FROM cloud_worker_starts WHERE attempt_id=?')
      .get(lease.attemptId)
    // Even an unconsumed permit admits a launch; only its absence proves unstarted.
    if (permit || started) {
      return { confirmed: false as const }
    }
    const job = context.get(String(row.job_id))
    context.db
      .prepare("UPDATE cloud_attempts SET status='cancelled_unstarted', ended_at=? WHERE id=?")
      .run(context.now(), lease.attemptId)
    context.db.prepare('DELETE FROM cloud_capacity_reservations WHERE job_id=?').run(job.id)
    if (row.status === 'running' && job.state === 'running') {
      context.save(
        job,
        { state: 'queued', waitingReason: null },
        'Unstarted claim withdrawn; awaiting current worker authority'
      )
    }
    return confirmed(lease)
  })
}

export function requestWorkerHostCancellation(context: CloudWorkerLedgerContext, input: unknown) {
  const lease = WorkerLeaseReceipt.parse(input)
  return cloudTransaction(context.db, () => {
    const row = matchingAttempt(context, lease)
    if (!row) {
      return { confirmed: false as const }
    }
    if (row.status === 'running') {
      const job = context.get(String(row.job_id))
      context.db
        .prepare("UPDATE cloud_attempts SET status='stopping', ended_at=? WHERE id=?")
        .run(context.now(), lease.attemptId)
      if (job.state === 'running') {
        context.save(
          job,
          { state: 'cancelled' },
          'Exact worker shutdown cancellation requested; stop proof pending'
        )
      }
    }
    // Reservations remain until the bound process stop receipt is acknowledged.
    return confirmed(lease)
  })
}
