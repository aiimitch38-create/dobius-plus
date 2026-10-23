import type SyncDatabase from '../../sqlite/sync-database'
import {
  CloudJobAdamBindingResponse,
  CloudJobAdamReceipt,
  CloudJobAdamReceiptRequest,
  canonicalCloudJobAdamJson,
  canonicalCloudJobAdamSha256,
  type CloudJobAdamBindingResponse as BindingResponse
} from '../../../shared/cloud-job-adam-receipts'
import { CloudJob, CloudJobInput } from '../../../shared/cloud-jobs'
import { CloudJobAdamOutboxNow } from './cloud-job-adam-outbox-schema'
import {
  isMatchingBinding,
  validateCloudJobAdamReceiptLedger
} from './cloud-job-adam-outbox-ledger'

export type CloudJobAdamBindingLinkResult = 'inserted' | 'duplicate'
export type CloudJobAdamReceiptAppendResult = {
  state: 'inserted' | 'duplicate'
  receiptId: string
  payloadSha256: string
}

/** Writes only into a transaction already opened by the owner of the CloudJob state change. */
export function recordCloudJobAdamBindingInTransaction(
  db: SyncDatabase,
  input: { jobId: string; bindingResponse: unknown; nowMs: number }
): CloudJobAdamBindingLinkResult {
  requireCallerTransaction(db)
  const response = CloudJobAdamBindingResponse.parse(input.bindingResponse)
  const now = CloudJobAdamOutboxNow.parse(input.nowMs)
  const { binding } = response
  const jobRow = db.prepare('SELECT document FROM cloud_jobs WHERE id=?').get(input.jobId)
  if (!jobRow) {
    throw new Error('ADAM binding cannot reference an unknown cloud job.')
  }
  const job = CloudJob.parse(JSON.parse(String(jobRow.document)))
  const jobInput = CloudJobInput.parse({
    requestKey: job.requestKey,
    taskId: job.taskId,
    projectId: job.projectId,
    workspaceId: job.workspaceId,
    targetDeviceId: job.targetDeviceId,
    recipeId: job.recipeId,
    title: job.title,
    sourceRevision: job.sourceRevision,
    estimatedBytes: job.estimatedBytes,
    dependencies: job.dependencies
  })
  if (
    job.id !== input.jobId ||
    binding.projectId !== job.projectId ||
    binding.requestFingerprint !== canonicalCloudJobAdamSha256(jobInput) ||
    response.bindingDigest !== canonicalCloudJobAdamSha256(binding)
  ) {
    throw new Error('ADAM binding does not match the immutable cloud job request.')
  }

  const existingForJob = db
    .prepare('SELECT * FROM cloud_job_adam_bindings WHERE job_id=?')
    .get(input.jobId)
  if (existingForJob) {
    if (sameStoredBinding(existingForJob, input.jobId, response)) {
      return 'duplicate'
    }
    throw new Error('ADAM binding ID conflicts with an existing immutable link.')
  }
  if (
    db
      .prepare('SELECT binding_id FROM cloud_job_adam_bindings WHERE binding_id=?')
      .get(binding.bindingId)
  ) {
    throw new Error('ADAM binding ID conflicts with an existing immutable link.')
  }
  if (now < response.boundAtMs || now >= binding.expiresAtMs) {
    throw new Error('ADAM binding grant is not fresh and unexpired at insertion time.')
  }

  const inserted = db
    .prepare(
      `INSERT INTO cloud_job_adam_bindings (
      job_id, binding_id, adam_instance_id, parent_objective_id, parent_objective_version,
      project_id, context_digest, request_fingerprint, binding_digest, bound_at_ms, expires_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`
    )
    .run(
      input.jobId,
      binding.bindingId,
      binding.adamInstanceId,
      binding.parentObjectiveId,
      binding.parentObjectiveVersion,
      binding.projectId,
      binding.contextDigest,
      binding.requestFingerprint,
      response.bindingDigest,
      response.boundAtMs,
      binding.expiresAtMs
    )

  const existing = db
    .prepare('SELECT * FROM cloud_job_adam_bindings WHERE job_id=?')
    .get(input.jobId)
  if (!existing || !sameStoredBinding(existing, input.jobId, response)) {
    throw new Error('ADAM binding ID conflicts with an existing immutable link.')
  }
  return Number(inserted.changes) > 0 ? 'inserted' : 'duplicate'
}

/** Appends only for an exact committed event, inside the caller's existing SQLite transaction. */
export function appendCloudJobAdamReceiptInTransaction(
  db: SyncDatabase,
  input: { jobId: string; receipt: unknown; nowMs: number }
): CloudJobAdamReceiptAppendResult {
  requireCallerTransaction(db)
  const receipt = CloudJobAdamReceipt.parse(input.receipt)
  const now = CloudJobAdamOutboxNow.parse(input.nowMs)
  const payloadSha256 = canonicalCloudJobAdamSha256(receipt)
  const payload = canonicalCloudJobAdamJson(
    CloudJobAdamReceiptRequest.parse({ schemaVersion: 1, receipt, payloadSha256 })
  )
  const jobRow = db.prepare('SELECT state, document FROM cloud_jobs WHERE id=?').get(input.jobId)
  if (!jobRow) {
    throw new Error('ADAM receipt cannot reference an unknown cloud job.')
  }
  const job = CloudJob.parse(JSON.parse(String(jobRow.document)))
  const requestFingerprint = canonicalCloudJobAdamSha256(
    CloudJobInput.parse(receiptInputFromJob(db, input.jobId))
  )
  const bindingRow = db
    .prepare('SELECT * FROM cloud_job_adam_bindings WHERE job_id=?')
    .get(input.jobId)
  if (!bindingRow || !isMatchingBinding(bindingRow, input.jobId, receipt, requestFingerprint)) {
    throw new Error('ADAM receipt does not match the immutable job binding.')
  }
  const existing = db
    .prepare(
      `SELECT receipt_id, job_id, binding_id, cloud_event_sequence, cloud_job_version,
        payload_json, payload_sha256 FROM cloud_job_adam_receipt_outbox
       WHERE receipt_id=? OR (job_id=? AND cloud_event_sequence=?)`
    )
    .get(receipt.receiptId, input.jobId, receipt.cloudEventSequence)
  if (existing) {
    if (
      existing.receipt_id !== receipt.receiptId ||
      existing.job_id !== input.jobId ||
      existing.binding_id !== receipt.bindingId ||
      Number(existing.cloud_event_sequence) !== receipt.cloudEventSequence ||
      Number(existing.cloud_job_version) !== receipt.cloudJobVersion ||
      existing.payload_json !== payload ||
      existing.payload_sha256 !== payloadSha256
    ) {
      throw new Error('ADAM receipt id or event sequence conflicts with different content.')
    }
    return { state: 'duplicate', receiptId: receipt.receiptId, payloadSha256 }
  }
  const event = db
    .prepare('SELECT job_id, version, state, at, reason FROM cloud_events WHERE sequence=?')
    .get(receipt.cloudEventSequence)
  if (
    job.id !== input.jobId ||
    job.version !== receipt.cloudJobVersion ||
    job.version !== Number(event?.version) ||
    job.state !== receipt.cloudJobState ||
    job.state !== jobRow.state ||
    event?.state !== receipt.cloudJobState ||
    job.projectId !== receipt.projectId ||
    receipt.occurredAtMs !== Number(event?.at) ||
    event?.job_id !== input.jobId ||
    !event
  ) {
    throw new Error('ADAM receipt does not match the exact committed cloud job event.')
  }

  validateCloudJobAdamReceiptLedger(db, {
    jobId: input.jobId,
    receipt,
    job,
    event: { at: event.at, reason: event.reason }
  })

  db.prepare(
    `INSERT INTO cloud_job_adam_receipt_outbox (
      receipt_id, job_id, binding_id, cloud_event_sequence, cloud_job_version, attempt_id,
      payload_json, payload_sha256, state, attempt_count, next_attempt_at_ms, created_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`
  ).run(
    receipt.receiptId,
    input.jobId,
    String(bindingRow.binding_id),
    receipt.cloudEventSequence,
    receipt.cloudJobVersion,
    receipt.attemptId,
    payload,
    payloadSha256,
    now,
    now
  )
  return { state: 'inserted', receiptId: receipt.receiptId, payloadSha256 }
}

export function cloudJobAdamOutboxStatus(db: SyncDatabase) {
  const rows = db
    .prepare('SELECT state, count(*) AS count FROM cloud_job_adam_receipt_outbox GROUP BY state')
    .all()
  const counts = { pending: 0, leased: 0, acked: 0, blocked: 0, total: 0 }
  for (const row of rows) {
    const state = row.state
    if (state === 'pending' || state === 'leased' || state === 'acked' || state === 'blocked') {
      const count = Number(row.count)
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new Error('ADAM outbox status is corrupt.')
      }
      counts[state] = count
      counts.total += count
    }
  }
  return counts
}

function receiptInputFromJob(db: SyncDatabase, jobId: string): unknown {
  const row = db.prepare('SELECT document FROM cloud_jobs WHERE id=?').get(jobId)
  if (!row) {
    throw new Error('ADAM receipt cannot reference an unknown cloud job.')
  }
  const job = CloudJob.parse(JSON.parse(String(row.document)))
  return {
    requestKey: job.requestKey,
    taskId: job.taskId,
    projectId: job.projectId,
    workspaceId: job.workspaceId,
    targetDeviceId: job.targetDeviceId,
    recipeId: job.recipeId,
    title: job.title,
    sourceRevision: job.sourceRevision,
    estimatedBytes: job.estimatedBytes,
    dependencies: job.dependencies
  }
}

function sameStoredBinding(
  row: Record<string, unknown>,
  jobId: string,
  response: BindingResponse
): boolean {
  const binding = response.binding
  return (
    row.job_id === jobId &&
    row.binding_id === binding.bindingId &&
    row.adam_instance_id === binding.adamInstanceId &&
    row.parent_objective_id === binding.parentObjectiveId &&
    Number(row.parent_objective_version) === binding.parentObjectiveVersion &&
    row.project_id === binding.projectId &&
    row.context_digest === binding.contextDigest &&
    row.request_fingerprint === binding.requestFingerprint &&
    row.binding_digest === response.bindingDigest &&
    Number(row.bound_at_ms) === response.boundAtMs &&
    Number(row.expires_at_ms) === binding.expiresAtMs
  )
}

export function requireCallerTransaction(db: SyncDatabase): void {
  const native = (db as unknown as { db?: { isTransaction?: unknown } }).db
  if (native?.isTransaction !== true) {
    throw new Error("ADAM outbox append requires the caller's existing SQLite transaction.")
  }
}
