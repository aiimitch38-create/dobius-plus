import { afterEach, describe, expect, it } from 'vitest'
import { outboxJob, outboxJobId, outboxReceipt } from './cloud-job-adam-outbox-fixtures'
import { cleanupFixtures, fixture, transaction } from './cloud-job-adam-outbox-test-support'
import { appendCloudJobAdamReceiptInTransaction } from './cloud-job-adam-outbox'

afterEach(cleanupFixtures)

describe('CloudJob ADAM start receipt event', () => {
  it('rejects a start event timestamp before durable process start', () => {
    const { db } = fixture()
    const running = outboxJob(4)
    running.state = 'running'
    running.updatedAt = 189
    transaction(db, () => {
      db.prepare('UPDATE cloud_jobs SET state=?, document=? WHERE id=?').run(
        running.state,
        JSON.stringify(running),
        running.id
      )
      db.prepare('UPDATE cloud_attempts SET status=? WHERE id=?').run(
        'running',
        outboxReceipt().attemptId
      )
      db.prepare(
        'INSERT INTO cloud_events(job_id, version, state, at, reason) VALUES (?, ?, ?, ?, ?)'
      ).run(
        running.id,
        running.version,
        running.state,
        running.updatedAt,
        'Worker confirmed bound process start receipt'
      )
    })

    expect(() =>
      transaction(db, () =>
        appendCloudJobAdamReceiptInTransaction(db, {
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
      )
    ).toThrow(/durable CloudJob ledger proof/)
    expect(db.prepare('SELECT * FROM cloud_job_adam_receipt_outbox').all()).toHaveLength(0)
  })
})
