import { createHash } from 'node:crypto'
import type { CloudJob } from '../../../shared/cloud-jobs'
import {
  CloudWorkerProcessIdentity,
  CloudWorkerStartBinding,
  CloudWorkerStopProof
} from '../../../shared/cloud-worker-enrollment'
import { cloudTransaction } from './database'
import { sameProcessIdentity, type CloudWorkerLedgerContext } from './cloud-worker-start-ledger'

const LEASE_MS = 60_000
const hash = (value: string) => createHash('sha256').update(value).digest('hex')

export function reconcileWorkerAttempt(
  context: CloudWorkerLedgerContext,
  args: {
    attemptId: string
    workerId: string
    token: string
    identityInput: unknown
  }
): 'owned' | 'stopping' | 'unknown' {
  const identity = CloudWorkerProcessIdentity.parse(args.identityInput)
  return cloudTransaction(context.db, () => {
    context.expireLeases()
    const attempt = context.db
      .prepare('SELECT * FROM cloud_attempts WHERE id=?')
      .get(args.attemptId)
    if (!attempt || attempt.worker !== args.workerId || attempt.lease_hash !== hash(args.token)) {
      throw new Error('Worker reconciliation lease does not own this attempt.')
    }
    if (!['running', 'stopping', 'interrupted'].includes(String(attempt.status))) {
      return 'unknown'
    }
    const started = context.db
      .prepare('SELECT * FROM cloud_worker_starts WHERE attempt_id=?')
      .get(args.attemptId)
    if (!started || !sameProcessIdentity(started, identity)) {
      return 'unknown'
    }
    return attempt.status === 'running' && Number(attempt.expires_at) > context.now()
      ? 'owned'
      : 'stopping'
  })
}

export function heartbeatWorkerAttempt(
  context: CloudWorkerLedgerContext,
  args: {
    attemptId: string
    workerId: string
    token: string
    outputBytes: number
    logCursor: number
  }
): number {
  if (
    !Number.isSafeInteger(args.outputBytes) ||
    args.outputBytes < 0 ||
    !Number.isSafeInteger(args.logCursor) ||
    args.logCursor < 0 ||
    args.logCursor > args.outputBytes
  ) {
    throw new Error('Worker progress is invalid.')
  }
  return cloudTransaction(context.db, () => {
    context.lease(args.attemptId, args.workerId, args.token)
    const started = context.db
      .prepare('SELECT * FROM cloud_worker_starts WHERE attempt_id=?')
      .get(args.attemptId)
    const permit = context.db
      .prepare('SELECT binding_json FROM cloud_worker_permits WHERE attempt_id=?')
      .get(args.attemptId)
    if (!started || !permit) {
      throw new Error('Heartbeat requires a durable started-process receipt.')
    }
    const binding = CloudWorkerStartBinding.parse(JSON.parse(String(permit.binding_json)))
    if (args.outputBytes > binding.caps.outputBytes) {
      throw new Error('Worker progress exceeds the authorized output cap.')
    }
    const expiry = context.now() + LEASE_MS
    context.db
      .prepare('UPDATE cloud_attempts SET expires_at=? WHERE id=?')
      .run(expiry, args.attemptId)
    context.db
      .prepare(
        `UPDATE cloud_worker_starts SET heartbeat_output_bytes=?, heartbeat_log_cursor=?, heartbeat_at=?
         WHERE attempt_id=?`
      )
      .run(args.outputBytes, args.logCursor, context.now(), args.attemptId)
    return expiry
  })
}

export function settleWorkerAttempt(
  context: CloudWorkerLedgerContext,
  args: {
    attemptId: string
    workerId: string
    token: string
    succeeded: boolean
    exitCode: number | null
    evidence: string[]
  }
): CloudJob {
  const receipt = { succeeded: args.succeeded, exitCode: args.exitCode, evidence: args.evidence }
  const receiptHash = hash(JSON.stringify(receipt))
  if (
    (!Number.isSafeInteger(args.exitCode) && args.exitCode !== null) ||
    args.evidence.length > 50 ||
    args.evidence.some((item) => typeof item !== 'string' || !item || item.length > 512)
  ) {
    throw new Error('Worker settlement receipt is invalid.')
  }
  return cloudTransaction(context.db, () => {
    const attempt = context.db
      .prepare('SELECT * FROM cloud_attempts WHERE id=?')
      .get(args.attemptId)
    if (!attempt || attempt.worker !== args.workerId || attempt.lease_hash !== hash(args.token)) {
      throw new Error('Worker settlement lease does not own this attempt.')
    }
    const started = context.db
      .prepare('SELECT * FROM cloud_worker_starts WHERE attempt_id=?')
      .get(args.attemptId)
    if (!started) {
      throw new Error('Settlement requires a durable started-process receipt.')
    }
    if (['succeeded', 'failed'].includes(String(attempt.status))) {
      if (started.settle_receipt_hash === receiptHash) {
        return context.get(String(attempt.job_id))
      }
      throw new Error('Attempt already settled with a different completion receipt.')
    }
    const job = context.lease(args.attemptId, args.workerId, args.token)
    const outcome =
      args.exitCode === null
        ? 'Executor exited without an exit code.'
        : `Executor exited with code ${args.exitCode}.`
    if (outcome.length > 1000) {
      throw new Error('Worker settlement outcome is too long.')
    }
    context.db
      .prepare('UPDATE cloud_attempts SET status=?, ended_at=? WHERE id=?')
      .run(args.succeeded ? 'succeeded' : 'failed', context.now(), args.attemptId)
    context.db.prepare('DELETE FROM cloud_capacity_reservations WHERE job_id=?').run(job.id)
    context.db
      .prepare('UPDATE cloud_worker_starts SET settle_receipt_hash=? WHERE attempt_id=?')
      .run(receiptHash, args.attemptId)
    return context.save(
      job,
      {
        state: args.succeeded ? 'needs_review' : 'failed',
        evidence: args.evidence,
        outcome
      },
      args.succeeded ? 'Execution finished; verification required' : 'Execution failed'
    )
  })
}

export function acknowledgeWorkerStopped(
  context: CloudWorkerLedgerContext,
  attemptId: string,
  workerId: string,
  token: string,
  proofInput: unknown
): void {
  const proof = CloudWorkerStopProof.parse(proofInput)
  const proofHash = hash(JSON.stringify(proof))
  cloudTransaction(context.db, () => {
    const row = context.db.prepare('SELECT * FROM cloud_attempts WHERE id=?').get(attemptId)
    if (
      !row ||
      row.worker !== workerId ||
      row.lease_hash !== hash(token) ||
      proof.attemptId !== attemptId ||
      proof.workerId !== workerId
    ) {
      throw new Error('Stop proof lease does not own this attempt.')
    }
    const started = context.db
      .prepare('SELECT * FROM cloud_worker_starts WHERE attempt_id=?')
      .get(attemptId)
    const permit = context.db
      .prepare('SELECT * FROM cloud_worker_permits WHERE attempt_id=?')
      .get(attemptId)
    if (!started || !permit) {
      throw new Error(
        'Legacy or unstarted attempts lack a bound process receipt; reservation retained.'
      )
    }
    if (row.status === 'stopped' && started.stop_proof_hash === proofHash) {
      return
    }
    if (
      !['stopping', 'interrupted'].includes(String(row.status)) ||
      proof.processGroupId !== Number(started.process_group_id) ||
      proof.bindingSha256 !== permit.binding_hash ||
      !sameProcessIdentity(started, proof.identity) ||
      proof.observedAt < Number(started.started_at) ||
      proof.observedAt > context.now()
    ) {
      throw new Error('Stop proof does not match the exact authorized process and source binding.')
    }
    context.db
      .prepare("UPDATE cloud_attempts SET status='stopped', ended_at=? WHERE id=?")
      .run(context.now(), attemptId)
    context.db
      .prepare(
        'UPDATE cloud_worker_starts SET stop_proof_hash=?, stop_proof_json=? WHERE attempt_id=?'
      )
      .run(proofHash, JSON.stringify(proof), attemptId)
    context.db
      .prepare('DELETE FROM cloud_capacity_reservations WHERE job_id=?')
      .run(String(row.job_id))
    context.save(context.get(String(row.job_id)), {}, 'Worker confirmed bound process stop proof')
  })
}

export function heartbeat(
  context: CloudWorkerLedgerContext,
  attemptId: string,
  workerId: string,
  token: string
): number {
  return cloudTransaction(context.db, () => {
    context.lease(attemptId, workerId, token)
    const expiry = context.now() + LEASE_MS
    context.db.prepare('UPDATE cloud_attempts SET expires_at=? WHERE id=?').run(expiry, attemptId)
    return expiry
  })
}

export function settle(
  context: CloudWorkerLedgerContext,
  attemptId: string,
  workerId: string,
  token: string,
  result: { succeeded: boolean; evidence: string[]; outcome: string }
): CloudJob {
  if (
    result.evidence.length > 50 ||
    result.evidence.some((item) => typeof item !== 'string' || !item || item.length > 512) ||
    typeof result.outcome !== 'string' ||
    result.outcome.length > 1000
  ) {
    throw new Error('Invalid result evidence.')
  }
  return cloudTransaction(context.db, () => {
    const job = context.lease(attemptId, workerId, token)
    const started = context.db
      .prepare('SELECT attempt_id FROM cloud_worker_starts WHERE attempt_id=? AND worker=?')
      .get(attemptId, workerId)
    if (!started) {
      throw new Error('Settlement requires a durable started-process receipt.')
    }
    context.db
      .prepare('UPDATE cloud_worker_starts SET settle_receipt_hash=? WHERE attempt_id=?')
      .run(hash(JSON.stringify(result)), attemptId)
    context.db
      .prepare('UPDATE cloud_attempts SET status=?, ended_at=? WHERE id=?')
      .run(result.succeeded ? 'succeeded' : 'failed', context.now(), attemptId)
    context.db.prepare('DELETE FROM cloud_capacity_reservations WHERE job_id=?').run(job.id)
    return context.save(
      job,
      {
        state: result.succeeded ? 'needs_review' : 'failed',
        evidence: result.evidence,
        outcome: result.outcome
      },
      result.succeeded ? 'Execution finished; verification required' : 'Execution failed'
    )
  })
}
