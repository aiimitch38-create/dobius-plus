import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { CloudWorkerStopProof } from '../../../shared/cloud-worker-enrollment'
import { appendCloudJobAdamReceiptInTransaction } from './cloud-job-adam-outbox'
import { adamReceipt } from './cloud-job-adam-client.fixtures'
import { outboxJob, outboxJobId, outboxReceipt } from './cloud-job-adam-outbox-fixtures'
import { append, cleanupFixtures, fixture, transaction } from './cloud-job-adam-outbox-test-support'

afterEach(cleanupFixtures)

describe('CloudJob ADAM receipt ledger evidence', () => {
  it('requires started, settlement, and bound stop proof instead of trusting event labels or cancelled state', () => {
    const startReason = 'Worker confirmed bound process start receipt'
    const startedFixture = fixture()
    const running = outboxJob(4)
    running.state = 'running'
    running.updatedAt = 204
    transaction(startedFixture.db, () => {
      startedFixture.db
        .prepare('UPDATE cloud_jobs SET state=?, document=? WHERE id=?')
        .run(running.state, JSON.stringify(running), running.id)
      startedFixture.db
        .prepare('UPDATE cloud_attempts SET status=? WHERE id=?')
        .run('running', adamReceipt().attemptId)
      startedFixture.db
        .prepare('DELETE FROM cloud_worker_starts WHERE attempt_id=?')
        .run(adamReceipt().attemptId)
      startedFixture.db
        .prepare(
          'INSERT INTO cloud_events(job_id, version, state, at, reason) VALUES (?, ?, ?, ?, ?)'
        )
        .run(running.id, running.version, running.state, running.updatedAt, startReason)
      expect(() =>
        appendCloudJobAdamReceiptInTransaction(startedFixture.db, {
          jobId: outboxJobId,
          receipt: outboxReceipt({
            cloudEventSequence: 2,
            cloudJobVersion: 4,
            cloudJobState: 'running',
            eventKind: 'attempt_started',
            occurredAtMs: running.updatedAt
          }),
          nowMs: 6_001
        })
      ).toThrow(/durable CloudJob ledger proof/)
    })
    expect(
      startedFixture.db.prepare('SELECT * FROM cloud_job_adam_receipt_outbox').all()
    ).toHaveLength(0)

    const validStartFixture = fixture()
    transaction(validStartFixture.db, () => {
      validStartFixture.db
        .prepare('UPDATE cloud_jobs SET state=?, document=? WHERE id=?')
        .run(running.state, JSON.stringify(running), running.id)
      validStartFixture.db
        .prepare('UPDATE cloud_attempts SET status=? WHERE id=?')
        .run('running', adamReceipt().attemptId)
      validStartFixture.db
        .prepare('UPDATE cloud_worker_starts SET settle_receipt_hash=NULL WHERE attempt_id=?')
        .run(adamReceipt().attemptId)
      validStartFixture.db
        .prepare(
          'INSERT INTO cloud_events(job_id, version, state, at, reason) VALUES (?, ?, ?, ?, ?)'
        )
        .run(running.id, running.version, running.state, running.updatedAt, startReason)
      expect(
        appendCloudJobAdamReceiptInTransaction(validStartFixture.db, {
          jobId: outboxJobId,
          receipt: outboxReceipt({
            cloudEventSequence: 2,
            cloudJobVersion: 4,
            cloudJobState: 'running',
            eventKind: 'attempt_started',
            occurredAtMs: running.updatedAt
          }),
          nowMs: 6_001
        }).state
      ).toBe('inserted')
    })

    const stoppedFixture = fixture()
    const cancelled = outboxJob(4)
    cancelled.state = 'cancelled'
    cancelled.updatedAt = 204
    transaction(stoppedFixture.db, () => {
      stoppedFixture.db
        .prepare('UPDATE cloud_jobs SET state=?, document=? WHERE id=?')
        .run(cancelled.state, JSON.stringify(cancelled), cancelled.id)
      stoppedFixture.db
        .prepare('UPDATE cloud_attempts SET status=? WHERE id=?')
        .run('stopping', adamReceipt().attemptId)
      stoppedFixture.db
        .prepare(
          'INSERT INTO cloud_events(job_id, version, state, at, reason) VALUES (?, ?, ?, ?, ?)'
        )
        .run(
          cancelled.id,
          cancelled.version,
          cancelled.state,
          cancelled.updatedAt,
          'Cancellation requested; worker must stop owned processes'
        )
      expect(() =>
        appendCloudJobAdamReceiptInTransaction(stoppedFixture.db, {
          jobId: outboxJobId,
          receipt: outboxReceipt({
            cloudEventSequence: 2,
            cloudJobVersion: 4,
            cloudJobState: 'cancelled',
            eventKind: 'process_stopped',
            occurredAtMs: cancelled.updatedAt
          }),
          nowMs: 6_001
        })
      ).toThrow(/durable CloudJob ledger proof/)
    })
    expect(
      stoppedFixture.db.prepare('SELECT * FROM cloud_job_adam_receipt_outbox').all()
    ).toHaveLength(0)

    const settlementFixture = fixture()
    expect(() =>
      append(settlementFixture.db, outboxReceipt({ attemptId: null, attemptNumber: null }))
    ).toThrow(/durable CloudJob ledger proof/)
    settlementFixture.db
      .prepare('UPDATE cloud_worker_starts SET settle_receipt_hash=NULL WHERE attempt_id=?')
      .run(adamReceipt().attemptId)
    expect(() => append(settlementFixture.db)).toThrow(/durable CloudJob ledger proof/)
    expect(
      settlementFixture.db.prepare('SELECT * FROM cloud_job_adam_receipt_outbox').all()
    ).toHaveLength(0)
  })

  it('accepts process_stopped only with a matching durable bound stop proof', () => {
    const { db } = fixture()
    const cancelled = outboxJob(4)
    cancelled.state = 'cancelled'
    cancelled.updatedAt = 204
    const proof = CloudWorkerStopProof.parse({
      attemptId: adamReceipt().attemptId,
      workerId: 'fixture-worker',
      processGroupId: 5002,
      observedAt: 195,
      descendantsAbsent: true,
      containment: 'posix-process-group',
      identity: {
        pid: 5001,
        processStart: 'process-start-1',
        processGroupId: 5002,
        bootId: 'boot-1',
        incarnation: 'worker-incarnation-1'
      },
      bindingSha256: 'b'.repeat(64)
    })
    const proofJson = JSON.stringify(proof)
    const proofHash = createHash('sha256').update(proofJson).digest('hex')
    transaction(db, () => {
      db.prepare('UPDATE cloud_jobs SET state=?, document=? WHERE id=?').run(
        cancelled.state,
        JSON.stringify(cancelled),
        cancelled.id
      )
      db.prepare('UPDATE cloud_attempts SET status=?, ended_at=? WHERE id=?').run(
        'stopped',
        cancelled.updatedAt,
        adamReceipt().attemptId
      )
      db.prepare(
        'UPDATE cloud_worker_starts SET stop_proof_hash=?, stop_proof_json=? WHERE attempt_id=?'
      ).run(proofHash, proofJson, adamReceipt().attemptId)
      db.prepare(
        'INSERT INTO cloud_events(job_id, version, state, at, reason) VALUES (?, ?, ?, ?, ?)'
      ).run(
        cancelled.id,
        cancelled.version,
        cancelled.state,
        cancelled.updatedAt,
        'Worker confirmed bound process stop proof'
      )
      expect(
        appendCloudJobAdamReceiptInTransaction(db, {
          jobId: outboxJobId,
          receipt: outboxReceipt({
            cloudEventSequence: 2,
            cloudJobVersion: 4,
            cloudJobState: 'cancelled',
            eventKind: 'process_stopped',
            occurredAtMs: cancelled.updatedAt
          }),
          nowMs: 6_001
        }).state
      ).toBe('inserted')
    })
    expect(db.prepare('SELECT * FROM cloud_job_adam_receipt_outbox').all()).toHaveLength(1)
  })

  it('requires failed events to match a real failed settlement and started-process receipt', () => {
    const { db } = fixture()
    const failed = outboxJob(4)
    failed.state = 'failed'
    failed.updatedAt = 204
    transaction(db, () => {
      db.prepare('UPDATE cloud_jobs SET state=?, document=? WHERE id=?').run(
        failed.state,
        JSON.stringify(failed),
        failed.id
      )
      db.prepare('UPDATE cloud_attempts SET status=?, ended_at=? WHERE id=?').run(
        'failed',
        202,
        adamReceipt().attemptId
      )
      db.prepare(
        'INSERT INTO cloud_events(job_id, version, state, at, reason) VALUES (?, ?, ?, ?, ?)'
      ).run(failed.id, failed.version, failed.state, failed.updatedAt, 'Execution failed')
      expect(
        appendCloudJobAdamReceiptInTransaction(db, {
          jobId: outboxJobId,
          receipt: outboxReceipt({
            cloudEventSequence: 2,
            cloudJobVersion: 4,
            cloudJobState: 'failed',
            eventKind: 'execution_failed',
            occurredAtMs: failed.updatedAt
          }),
          nowMs: 6_001
        }).state
      ).toBe('inserted')
    })

    const mismatched = fixture()
    transaction(mismatched.db, () => {
      mismatched.db
        .prepare('UPDATE cloud_jobs SET state=?, document=? WHERE id=?')
        .run(failed.state, JSON.stringify(failed), failed.id)
      mismatched.db
        .prepare(
          'INSERT INTO cloud_events(job_id, version, state, at, reason) VALUES (?, ?, ?, ?, ?)'
        )
        .run(failed.id, failed.version, failed.state, failed.updatedAt, 'Execution failed')
      expect(() =>
        appendCloudJobAdamReceiptInTransaction(mismatched.db, {
          jobId: outboxJobId,
          receipt: outboxReceipt({
            cloudEventSequence: 2,
            cloudJobVersion: 4,
            cloudJobState: 'failed',
            eventKind: 'execution_failed',
            occurredAtMs: failed.updatedAt
          }),
          nowMs: 6_001
        })
      ).toThrow(/durable CloudJob ledger proof/)
    })
    expect(mismatched.db.prepare('SELECT * FROM cloud_job_adam_receipt_outbox').all()).toHaveLength(
      0
    )
  })

  it('rolls back the job event and outbox append together with the caller transaction', () => {
    const { db } = fixture()
    const next = outboxJob(4)
    next.updatedAt = 204
    expect(() =>
      transaction(db, () => {
        db.prepare('UPDATE cloud_jobs SET state=?, document=? WHERE id=?').run(
          next.state,
          JSON.stringify(next),
          next.id
        )
        db.prepare(
          'INSERT INTO cloud_events(job_id, version, state, at, reason) VALUES (?, ?, ?, ?, ?)'
        ).run(
          next.id,
          next.version,
          next.state,
          next.updatedAt,
          'Execution finished; verification required'
        )
        appendCloudJobAdamReceiptInTransaction(db, {
          jobId: outboxJobId,
          receipt: outboxReceipt({ cloudEventSequence: 2, cloudJobVersion: 4, occurredAtMs: 204 }),
          nowMs: 6_000
        })
        throw new Error('synthetic rollback')
      })
    ).toThrow('synthetic rollback')
    expect(db.prepare('SELECT sequence FROM cloud_events WHERE sequence=2').get()).toBeUndefined()
    expect(db.prepare('SELECT * FROM cloud_job_adam_receipt_outbox').all()).toHaveLength(0)
    expect(
      JSON.parse(
        String(db.prepare('SELECT document FROM cloud_jobs WHERE id=?').get(outboxJobId)?.document)
      ).version
    ).toBe(3)
  })
})
