import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import SyncDatabase from '../../sqlite/sync-database'
import {
  appendCloudJobAdamReceiptInTransaction,
  recordCloudJobAdamBindingInTransaction
} from './cloud-job-adam-outbox'
import {
  createOutboxSchema,
  insertOutboxJob,
  outboxBinding,
  outboxJob,
  outboxJobId,
  outboxReceipt
} from './cloud-job-adam-outbox-fixtures'

type Fixture = { directory?: string; file: string; db: SyncDatabase }
export const fixtures: Fixture[] = []

export function fixture(): Fixture {
  const directory = mkdtempSync(join(tmpdir(), 'dobius-adam-outbox-'))
  const file = join(directory, 'cloud.sqlite')
  const db = new SyncDatabase(file)
  const value = { directory, file, db }
  fixtures.push(value)
  createOutboxSchema(db)
  insertOutboxJob(db)
  transaction(db, () =>
    recordCloudJobAdamBindingInTransaction(db, {
      jobId: outboxJobId,
      bindingResponse: outboxBinding(),
      nowMs: 6_000
    })
  )
  return value
}

export function transaction<T>(db: SyncDatabase, action: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const value = action()
    db.exec('COMMIT')
    return value
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function append(db: SyncDatabase, receipt = outboxReceipt()) {
  return transaction(db, () =>
    appendCloudJobAdamReceiptInTransaction(db, {
      jobId: outboxJobId,
      receipt,
      nowMs: 6_000
    })
  )
}

export function appendSecondEvent(db: SyncDatabase): void {
  const secondJob = outboxJob(4)
  secondJob.updatedAt = 204
  transaction(db, () => {
    db.prepare('UPDATE cloud_jobs SET state=?, document=? WHERE id=?').run(
      secondJob.state,
      JSON.stringify(secondJob),
      secondJob.id
    )
    db.prepare(
      'INSERT INTO cloud_events(job_id, version, state, at, reason) VALUES (?, ?, ?, ?, ?)'
    ).run(
      secondJob.id,
      secondJob.version,
      secondJob.state,
      secondJob.updatedAt,
      'Execution finished; verification required'
    )
    appendCloudJobAdamReceiptInTransaction(db, {
      jobId: outboxJobId,
      receipt: outboxReceipt({ cloudEventSequence: 2, cloudJobVersion: 4, occurredAtMs: 204 }),
      nowMs: 6_001
    })
  })
}

export function cleanupFixtures(): void {
  const directories = new Set<string>()
  for (const item of fixtures.splice(0)) {
    item.db.close()
    if (item.directory) {
      directories.add(item.directory)
    }
  }
  for (const directory of directories) {
    rmSync(directory, { recursive: true, force: true })
  }
}
