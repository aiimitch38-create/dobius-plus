import { randomUUID } from 'node:crypto'
import type SyncDatabase from '../../sqlite/sync-database'
import {
  CloudJobAdamReceiptAck,
  CloudJobAdamReceiptRequest,
  canonicalCloudJobAdamJson,
  canonicalCloudJobAdamSha256,
  type CloudJobAdamReceiptRequest as ReceiptRequest
} from '../../../shared/cloud-job-adam-receipts'
import {
  CloudJobAdamOutboxBindingId,
  CloudJobAdamOutboxFailure,
  CloudJobAdamOutboxLeaseMs,
  CloudJobAdamOutboxLeaseNonce,
  CloudJobAdamOutboxLeaseOwner,
  CloudJobAdamOutboxNow,
  type CloudJobAdamOutboxFailure as FailureCode
} from './cloud-job-adam-outbox-schema'

const MAX_DELIVERY_ATTEMPTS = 10
const MAX_BACKOFF_MS = 60_000

export type CloudJobAdamOutboxClaim =
  | { state: 'empty' | 'not-due' | 'leased' | 'blocked' }
  | {
      state: 'claimed'
      receiptId: string
      bindingId: string
      owner: string
      nonce: string
      leaseExpiresAtMs: number
      deliveryAttempt: number
      request: ReceiptRequest
    }

/** Claims only the oldest unacknowledged receipt for one binding. */
export function claimNextCloudJobAdamReceipt(
  db: SyncDatabase,
  input: { bindingId: string; owner: string; nowMs: number; leaseMs: number }
): CloudJobAdamOutboxClaim {
  const owner = CloudJobAdamOutboxLeaseOwner.parse(input.owner)
  const bindingId = CloudJobAdamOutboxBindingId.parse(input.bindingId)
  const now = CloudJobAdamOutboxNow.parse(input.nowMs)
  const leaseMs = CloudJobAdamOutboxLeaseMs.parse(input.leaseMs)
  const nonce = randomUUID()
  return outboxTransaction(db, () => {
    const row = db
      .prepare(
        `SELECT * FROM cloud_job_adam_receipt_outbox
         WHERE binding_id=? AND state<>'acked'
         ORDER BY cloud_event_sequence LIMIT 1`
      )
      .get(bindingId)
    if (!row) {
      return { state: 'empty' }
    }
    if (row.state === 'blocked') {
      return { state: 'blocked' }
    }
    if (row.state === 'leased' && Number(row.lease_expires_at_ms) > now) {
      return { state: 'leased' }
    }
    if (row.state === 'pending' && Number(row.next_attempt_at_ms) > now) {
      return { state: 'not-due' }
    }

    let request: ReceiptRequest
    try {
      request = CloudJobAdamReceiptRequest.parse(JSON.parse(String(row.payload_json)))
      const digest = canonicalCloudJobAdamSha256(request.receipt)
      if (
        request.receipt.receiptId !== row.receipt_id ||
        request.payloadSha256 !== digest ||
        row.payload_sha256 !== digest
      ) {
        throw new Error('Outbox payload digest mismatch.')
      }
    } catch {
      db.prepare(
        `UPDATE cloud_job_adam_receipt_outbox SET state='blocked', last_failure_code='corrupt-payload',
         lease_owner=NULL, lease_nonce=NULL, lease_expires_at_ms=NULL WHERE receipt_id=?`
      ).run(String(row.receipt_id))
      return { state: 'blocked' }
    }

    const leaseExpiresAtMs = now + leaseMs
    if (!Number.isSafeInteger(leaseExpiresAtMs)) {
      throw new RangeError('ADAM outbox lease expiry exceeds the safe integer range.')
    }
    const claimed = db
      .prepare(
        `UPDATE cloud_job_adam_receipt_outbox SET state='leased', attempt_count=attempt_count+1,
         lease_owner=?, lease_nonce=?, lease_expires_at_ms=?
         WHERE receipt_id=? AND (
           (state='pending' AND next_attempt_at_ms<=?) OR
           (state='leased' AND lease_expires_at_ms<=?)
         )`
      )
      .run(owner, nonce, leaseExpiresAtMs, String(row.receipt_id), now, now)
    if (Number(claimed.changes) !== 1) {
      return { state: 'leased' }
    }
    return {
      state: 'claimed',
      receiptId: String(row.receipt_id),
      bindingId: String(row.binding_id),
      owner,
      nonce,
      leaseExpiresAtMs,
      deliveryAttempt: Number(row.attempt_count) + 1,
      request
    }
  })
}

/** Stores only the strict ack; replaying the same ack is idempotent, any changed ack conflicts. */
export function acknowledgeCloudJobAdamReceipt(
  db: SyncDatabase,
  input: {
    receiptId: string
    owner: string
    nonce: string
    ack: unknown
    nowMs: number
  }
): 'acked' | 'duplicate' {
  const ack = CloudJobAdamReceiptAck.parse(input.ack)
  const owner = CloudJobAdamOutboxLeaseOwner.parse(input.owner)
  const nonce = CloudJobAdamOutboxLeaseNonce.parse(input.nonce)
  const now = CloudJobAdamOutboxNow.parse(input.nowMs)
  const ackJson = canonicalCloudJobAdamJson(ack)
  return outboxTransaction(db, () => {
    const row = db
      .prepare('SELECT * FROM cloud_job_adam_receipt_outbox WHERE receipt_id=?')
      .get(input.receiptId)
    if (!row) {
      throw new Error('ADAM receipt does not exist in the outbox.')
    }
    if (row.state === 'acked') {
      if (
        row.ack_json !== ackJson ||
        ack.receiptId !== input.receiptId ||
        ack.payloadSha256 !== row.payload_sha256
      ) {
        throw new Error('ADAM receipt ack conflicts with the durable acknowledgement.')
      }
      return 'duplicate'
    }
    if (
      row.state !== 'leased' ||
      row.lease_owner !== owner ||
      row.lease_nonce !== nonce ||
      Number(row.lease_expires_at_ms) <= now
    ) {
      throw new Error('ADAM receipt delivery lease is stale or no longer owned.')
    }
    if (ack.receiptId !== input.receiptId || ack.payloadSha256 !== row.payload_sha256) {
      throw new Error('ADAM receipt acknowledgement does not match exact receipt ID and digest.')
    }
    const acked = db
      .prepare(
        `UPDATE cloud_job_adam_receipt_outbox SET state='acked', ack_json=?, last_failure_code=NULL,
       lease_owner=NULL, lease_nonce=NULL, lease_expires_at_ms=NULL WHERE receipt_id=? AND state='leased'
       AND lease_owner=? AND lease_nonce=? AND lease_expires_at_ms>?`
      )
      .run(ackJson, input.receiptId, owner, nonce, now)
    if (Number(acked.changes) !== 1) {
      throw new Error('ADAM receipt delivery lease changed before acknowledgement commit.')
    }
    return 'acked'
  })
}

/** Maps only typed transport outcomes to bounded retry or blocked state; remote bodies are discarded. */
export function recordCloudJobAdamReceiptFailure(
  db: SyncDatabase,
  input: { receiptId: string; owner: string; nonce: string; failure: unknown; nowMs: number }
): 'retry' | 'blocked' {
  const failure = CloudJobAdamOutboxFailure.parse(input.failure)
  const owner = CloudJobAdamOutboxLeaseOwner.parse(input.owner)
  const nonce = CloudJobAdamOutboxLeaseNonce.parse(input.nonce)
  const now = CloudJobAdamOutboxNow.parse(input.nowMs)
  return outboxTransaction(db, () => {
    const row = db
      .prepare('SELECT * FROM cloud_job_adam_receipt_outbox WHERE receipt_id=?')
      .get(input.receiptId)
    assertOwnedLiveLease(row, input.receiptId, owner, nonce, now)
    const attemptCount = Number(row.attempt_count)
    const backoff = Math.min(
      MAX_BACKOFF_MS,
      1_000 * 2 ** Math.max(0, Math.min(MAX_DELIVERY_ATTEMPTS - 1, attemptCount - 1))
    )
    const timeExhausted = now > Number.MAX_SAFE_INTEGER - backoff
    const blocked =
      isPermanentFailure(failure) || attemptCount >= MAX_DELIVERY_ATTEMPTS || timeExhausted
    const state = blocked ? 'blocked' : 'pending'
    const lastFailure =
      attemptCount >= MAX_DELIVERY_ATTEMPTS || timeExhausted ? 'retry-limit' : failure
    const nextAttemptAt = now + backoff
    const released = db
      .prepare(
        `UPDATE cloud_job_adam_receipt_outbox SET state=?, next_attempt_at_ms=?, last_failure_code=?,
       lease_owner=NULL, lease_nonce=NULL, lease_expires_at_ms=NULL WHERE receipt_id=? AND state='leased'
       AND lease_owner=? AND lease_nonce=? AND lease_expires_at_ms>?`
      )
      .run(state, nextAttemptAt, lastFailure, input.receiptId, owner, nonce, now)
    if (Number(released.changes) !== 1) {
      throw new Error('ADAM receipt delivery lease changed before failure commit.')
    }
    return state === 'blocked' ? 'blocked' : 'retry'
  })
}

function isPermanentFailure(failure: FailureCode): boolean {
  return [
    'auth-unavailable',
    'unauthorized',
    'conflict',
    'unsupported',
    'malformed-response'
  ].includes(failure)
}

function assertOwnedLiveLease(
  row: Record<string, unknown> | undefined,
  receiptId: string,
  owner: string,
  nonce: string,
  now: number
): asserts row is Record<string, unknown> {
  if (
    row?.state !== 'leased' ||
    row.receipt_id !== receiptId ||
    row.lease_owner !== owner ||
    row.lease_nonce !== nonce ||
    Number(row.lease_expires_at_ms) <= now
  ) {
    throw new Error('ADAM receipt delivery lease is stale or no longer owned.')
  }
}

function outboxTransaction<T>(db: SyncDatabase, action: () => T): T {
  const native = (db as unknown as { db?: { isTransaction?: unknown } }).db
  if (native?.isTransaction !== false) {
    throw new Error('ADAM outbox lease operation requires an idle shared SQLite connection.')
  }
  db.exec('BEGIN IMMEDIATE')
  try {
    const value = action()
    db.exec('COMMIT')
    return value
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // Preserve the original operation error if SQLite already closed the transaction.
    }
    throw error
  }
}
