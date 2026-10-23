import { createHash } from 'node:crypto'
import type SyncDatabase from '../../sqlite/sync-database'
import { CloudWorkerStopProof } from '../../../shared/cloud-worker-enrollment'
import type { CloudJob } from '../../../shared/cloud-jobs'
import type { CloudJobAdamReceipt } from '../../../shared/cloud-job-adam-receipts'

type AttemptRow = Record<string, unknown>
type EventRow = { reason: unknown; at: unknown }

export function validateCloudJobAdamReceiptLedger(
  db: SyncDatabase,
  input: {
    jobId: string
    receipt: CloudJobAdamReceipt
    job: CloudJob
    event: EventRow
  }
): void {
  const { receipt, job, event } = input
  const attempt = receipt.attemptId
    ? db.prepare('SELECT * FROM cloud_attempts WHERE id=?').get(receipt.attemptId)
    : undefined

  if (
    receipt.eventKind === 'submitted' &&
    (event.reason !== 'Submitted' || job.state !== 'queued' || attempt || job.attemptCount !== 0)
  ) {
    rejectLedger()
  }

  if (receipt.eventKind === 'attempt_started') {
    const running = requireAttempt(attempt, input.jobId, job, receipt)
    const started = readStartedEvidence(db, running, input.jobId, job.projectId)
    if (
      event.reason !== 'Worker confirmed bound process start receipt' ||
      !started ||
      Number(event.at) < Number(started.started_at) ||
      job.state !== 'running' ||
      running.status !== 'running'
    ) {
      rejectLedger()
    }
  }

  if (receipt.eventKind === 'execution_needs_review') {
    requireSettlement(
      db,
      attempt,
      input.jobId,
      job,
      receipt,
      'succeeded',
      'needs_review',
      'Execution finished; verification required',
      event
    )
  }

  if (receipt.eventKind === 'execution_failed') {
    requireSettlement(
      db,
      attempt,
      input.jobId,
      job,
      receipt,
      'failed',
      'failed',
      'Execution failed',
      event
    )
  }

  if (receipt.eventKind === 'review_accepted') {
    requireSettlement(
      db,
      attempt,
      input.jobId,
      job,
      receipt,
      'succeeded',
      'completed',
      'Reviewer accepted',
      event
    )
    if (job.evidence.length === 0) {
      rejectLedger()
    }
  }

  if (receipt.eventKind === 'cancellation_requested') {
    if (
      ![
        'Cancellation requested; worker must stop owned processes',
        'Exact worker shutdown cancellation requested; stop proof pending'
      ].includes(String(event.reason)) ||
      job.state !== 'cancelled'
    ) {
      rejectLedger()
    }
    if (receipt.attemptId !== null) {
      const linked = requireAttempt(attempt, input.jobId, job, receipt)
      if (
        !['running', 'stopping', 'stopped', 'cancelled_unstarted'].includes(String(linked.status))
      ) {
        rejectLedger()
      }
    }
  }

  if (receipt.eventKind === 'process_stopped') {
    const stopped = requireAttempt(attempt, input.jobId, job, receipt)
    const started = readStartedEvidence(db, stopped, input.jobId, job.projectId)
    if (
      event.reason !== 'Worker confirmed bound process stop proof' ||
      !['cancelled', 'interrupted'].includes(job.state) ||
      stopped.status !== 'stopped' ||
      !Number.isSafeInteger(Number(stopped.ended_at)) ||
      !started ||
      !hasBoundStopProof(started, stopped, event)
    ) {
      rejectLedger()
    }
  }

  if (receipt.eventKind === 'interrupted') {
    const interrupted = requireAttempt(attempt, input.jobId, job, receipt)
    if (
      event.reason !== 'Worker lease expired' ||
      job.state !== 'interrupted' ||
      interrupted.status !== 'interrupted'
    ) {
      rejectLedger()
    }
  }

  if (receipt.eventKind === 'retry_queued') {
    const prior = requireAttempt(attempt, input.jobId, job, receipt)
    if (
      event.reason !== 'Explicit retry' ||
      job.state !== 'queued' ||
      !['failed', 'interrupted', 'stopped', 'cancelled_unstarted'].includes(String(prior.status))
    ) {
      rejectLedger()
    }
  }
}

export function isMatchingBinding(
  row: Record<string, unknown> | undefined,
  jobId: string,
  receipt: CloudJobAdamReceipt,
  requestFingerprint: string
): boolean {
  return Boolean(
    row?.job_id === jobId &&
    row.binding_id === receipt.bindingId &&
    row.project_id === receipt.projectId &&
    row.context_digest === receipt.contextDigest &&
    row.adam_instance_id === receipt.adamInstanceId &&
    row.parent_objective_id === receipt.parentObjectiveId &&
    Number(row.parent_objective_version) === receipt.parentObjectiveVersion &&
    row.request_fingerprint === requestFingerprint
  )
}

function requireSettlement(
  db: SyncDatabase,
  attemptInput: AttemptRow | undefined,
  jobId: string,
  job: CloudJob,
  receipt: CloudJobAdamReceipt,
  attemptState: 'succeeded' | 'failed',
  jobState: CloudJob['state'],
  eventReason: string,
  event: EventRow
): void {
  const attempt = requireAttempt(attemptInput, jobId, job, receipt)
  const started = readStartedEvidence(db, attempt, jobId, job.projectId)
  if (
    job.state !== jobState ||
    event.reason !== eventReason ||
    attempt.status !== attemptState ||
    !started ||
    !isSha256(started.settle_receipt_hash) ||
    Number(attempt.ended_at) < Number(started.started_at) ||
    Number(event.at) < Number(attempt.ended_at)
  ) {
    rejectLedger()
  }
}

function requireAttempt(
  attempt: AttemptRow | undefined,
  jobId: string,
  job: CloudJob,
  receipt: CloudJobAdamReceipt
): AttemptRow {
  if (
    receipt.attemptId === null ||
    receipt.attemptNumber === null ||
    attempt?.id !== receipt.attemptId ||
    attempt.job_id !== jobId ||
    receipt.attemptNumber !== job.attemptCount
  ) {
    return rejectLedger()
  }
  return attempt
}

function readStartedEvidence(
  db: SyncDatabase,
  attempt: AttemptRow,
  jobId: string,
  projectId: string
): (Record<string, unknown> & { binding_hash: unknown }) | null {
  const row = db
    .prepare(
      `SELECT s.*, p.job_id AS permit_job_id, p.project_id AS permit_project_id,
        p.binding_hash, p.consumed_at, p.permit_id AS saved_permit_id,
        p.worker AS permit_worker
       FROM cloud_worker_starts s
       JOIN cloud_worker_permits p ON p.attempt_id=s.attempt_id
       WHERE s.attempt_id=?`
    )
    .get(String(attempt.id))
  return row?.permit_job_id === jobId &&
    row.permit_project_id === projectId &&
    row.permit_id === row.saved_permit_id &&
    row.worker === attempt.worker &&
    row.permit_worker === attempt.worker &&
    row.consumed_at !== null &&
    row.consumed_at !== undefined
    ? (row as Record<string, unknown> & { binding_hash: unknown })
    : null
}

function hasBoundStopProof(
  started: Record<string, unknown>,
  attempt: AttemptRow,
  event: EventRow
): boolean {
  try {
    const proof = CloudWorkerStopProof.parse(JSON.parse(String(started.stop_proof_json)))
    const digest = createHash('sha256').update(JSON.stringify(proof)).digest('hex')
    return (
      started.stop_proof_hash === digest &&
      proof.attemptId === attempt.id &&
      proof.workerId === attempt.worker &&
      proof.processGroupId === Number(started.process_group_id) &&
      proof.bindingSha256 === started.binding_hash &&
      proof.identity.pid === Number(started.pid) &&
      proof.identity.processStart === started.process_start &&
      proof.identity.processGroupId === Number(started.process_group_id) &&
      proof.identity.bootId === started.boot_id &&
      proof.identity.incarnation === started.incarnation &&
      proof.observedAt >= Number(started.started_at) &&
      proof.observedAt <= Number(event.at)
    )
  } catch {
    return false
  }
}

function isSha256(value: unknown): boolean {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function rejectLedger(): never {
  throw new Error('ADAM receipt event kind lacks matching durable CloudJob ledger proof.')
}
