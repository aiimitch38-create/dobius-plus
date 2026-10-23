import { randomUUID } from 'node:crypto'
import type SyncDatabase from '../../sqlite/sync-database'
import type { CloudJob } from '../../../shared/cloud-jobs'
import type { CloudJobAdamReceipt } from '../../../shared/cloud-job-adam-receipts'
import { appendCloudJobAdamReceiptInTransaction } from './cloud-job-adam-outbox'

const kinds: Record<string, CloudJobAdamReceipt['eventKind']> = {
  Submitted: 'submitted',
  'Worker confirmed bound process start receipt': 'attempt_started',
  'Execution finished; verification required': 'execution_needs_review',
  'Execution failed': 'execution_failed',
  'Cancellation requested; worker must stop owned processes': 'cancellation_requested',
  'Exact worker shutdown cancellation requested; stop proof pending': 'cancellation_requested',
  'Worker confirmed bound process stop proof': 'process_stopped',
  'Worker lease expired': 'interrupted',
  'Explicit retry': 'retry_queued',
  'Reviewer accepted': 'review_accepted'
}

/** Called within the state/event transaction; failure must roll back the state change too. */
export function appendAdamReceiptForCloudEvent(
  db: SyncDatabase,
  job: CloudJob,
  reason: string,
  sequence: number,
  nowMs: number
): void {
  const binding = db.prepare('SELECT * FROM cloud_job_adam_bindings WHERE job_id=?').get(job.id)
  const eventKind = kinds[reason]
  if (!binding || !eventKind) {
    return
  }
  const attempt =
    job.attemptCount > 0
      ? db
          .prepare('SELECT id FROM cloud_attempts WHERE job_id=? ORDER BY rowid DESC LIMIT 1')
          .get(job.id)
      : undefined
  if (job.attemptCount > 0 && !attempt) {
    throw new Error('ADAM event is missing its durable attempt.')
  }
  appendCloudJobAdamReceiptInTransaction(db, {
    jobId: job.id,
    nowMs,
    receipt: {
      schemaVersion: 1,
      receiptId: randomUUID(),
      bindingId: binding.binding_id,
      adamInstanceId: binding.adam_instance_id,
      parentObjectiveId: binding.parent_objective_id,
      parentObjectiveVersion: Number(binding.parent_objective_version),
      cloudJobId: job.id,
      cloudJobVersion: job.version,
      cloudEventSequence: sequence,
      attemptId: attempt ? String(attempt.id) : null,
      attemptNumber: attempt ? job.attemptCount : null,
      eventKind,
      cloudJobState: job.state,
      projectId: job.projectId,
      contextDigest: binding.context_digest,
      // Stored references are not verified artifact bytes; do not invent content hashes.
      evidenceDigests: [],
      occurredAtMs: job.updatedAt
    }
  })
}
