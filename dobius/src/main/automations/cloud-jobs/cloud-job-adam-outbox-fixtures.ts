import type SyncDatabase from '../../sqlite/sync-database'
import { CloudJob } from '../../../shared/cloud-jobs'
import { adamBindingResponse, adamJobInput, adamReceipt } from './cloud-job-adam-client.fixtures'
import { cloudJobAdamOutboxMigrationDDL } from './cloud-job-adam-outbox-schema'

export const outboxJobId = 'f27995d3-5a22-462c-93f0-37dcd1f98841'
export const outboxBindingId = 'b318dc55-1f52-4eaf-9e77-9b5ca269cf97'
export const outboxOwnerA = 'outbox-worker-a'
export const outboxOwnerB = 'outbox-worker-b'

export function createOutboxSchema(db: SyncDatabase): void {
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE cloud_jobs (
      id TEXT PRIMARY KEY, creator TEXT NOT NULL, request_key TEXT NOT NULL,
      fingerprint TEXT NOT NULL, state TEXT NOT NULL, target TEXT NOT NULL,
      created_at INTEGER NOT NULL, document TEXT NOT NULL
    );
    CREATE TABLE cloud_attempts (
      id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES cloud_jobs(id),
      worker TEXT NOT NULL, lease_hash TEXT NOT NULL, expires_at INTEGER NOT NULL,
      status TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER
    );
    CREATE TABLE cloud_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL REFERENCES cloud_jobs(id),
      version INTEGER NOT NULL, state TEXT NOT NULL, at INTEGER NOT NULL, reason TEXT NOT NULL
    );
    CREATE TABLE cloud_worker_permits (
      attempt_id TEXT PRIMARY KEY REFERENCES cloud_attempts(id), permit_id TEXT NOT NULL,
      worker TEXT NOT NULL, device_id TEXT NOT NULL, project_id TEXT NOT NULL, job_id TEXT NOT NULL,
      binding_hash TEXT NOT NULL, consumed_at INTEGER
    );
    CREATE TABLE cloud_worker_starts (
      attempt_id TEXT PRIMARY KEY REFERENCES cloud_worker_permits(attempt_id),
      permit_id TEXT NOT NULL, worker TEXT NOT NULL, device_id TEXT NOT NULL, pid INTEGER NOT NULL,
      process_start TEXT NOT NULL, process_group_id INTEGER NOT NULL, boot_id TEXT NOT NULL,
      incarnation TEXT NOT NULL, started_at INTEGER NOT NULL, stop_proof_hash TEXT,
      stop_proof_json TEXT, settle_receipt_hash TEXT
    );
  `)
  db.exec(cloudJobAdamOutboxMigrationDDL())
}

export function outboxJob(version = 3): CloudJob {
  return CloudJob.parse({
    ...adamJobInput(),
    id: outboxJobId,
    createdBy: 'fixture-creator',
    state: 'needs_review',
    version,
    createdAt: 100,
    updatedAt: 200 + version,
    attemptCount: 1,
    waitingReason: null,
    evidence: [],
    outcome: 'Synthetic executor exited; review required.'
  })
}

export function insertOutboxJob(db: SyncDatabase, job = outboxJob()): void {
  db.prepare('INSERT INTO cloud_jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    job.id,
    job.createdBy,
    job.requestKey,
    'fixture-store-fingerprint',
    job.state,
    job.targetDeviceId,
    job.createdAt,
    JSON.stringify(job)
  )
  db.prepare('INSERT INTO cloud_attempts VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    adamReceipt().attemptId,
    job.id,
    'fixture-worker',
    'lease-hash-only',
    10_000,
    'succeeded',
    180,
    200
  )
  db.prepare('INSERT INTO cloud_worker_permits VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    adamReceipt().attemptId,
    'fixture-permit',
    'fixture-worker',
    'worker-1',
    job.projectId,
    job.id,
    'b'.repeat(64),
    181
  )
  db.prepare('INSERT INTO cloud_worker_starts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    adamReceipt().attemptId,
    'fixture-permit',
    'fixture-worker',
    'worker-1',
    5001,
    'process-start-1',
    5002,
    'boot-1',
    'worker-incarnation-1',
    190,
    null,
    null,
    'f'.repeat(64)
  )
  db.prepare(
    'INSERT INTO cloud_events(job_id, version, state, at, reason) VALUES (?, ?, ?, ?, ?)'
  ).run(job.id, job.version, job.state, job.updatedAt, 'Execution finished; verification required')
}

export function outboxReceipt(
  patch: Partial<ReturnType<typeof adamReceipt>> = {}
): ReturnType<typeof adamReceipt> {
  const receipt = adamReceipt()
  if (patch.cloudEventSequence === 2 && !patch.receiptId) {
    receipt.receiptId = '09c2af89-b03f-4177-9ca4-43ba0a5df7e2'
  }
  return {
    ...receipt,
    bindingId: outboxBindingId,
    cloudJobId: outboxJobId,
    cloudEventSequence: 1,
    cloudJobVersion: 3,
    occurredAtMs: 203,
    ...patch
  }
}

export function outboxBinding() {
  return adamBindingResponse()
}

export function fixtureJobInput() {
  return adamJobInput()
}
