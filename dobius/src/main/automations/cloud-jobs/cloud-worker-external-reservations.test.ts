import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type SyncDatabase from '../../sqlite/sync-database'
import { cloudTransaction, openCloudJobsDatabase } from './database'
import { createCloudWorkerExternalReservationLedger } from './cloud-worker-external-reservations'

const directories: string[] = []
const databases: SyncDatabase[] = []
const scope = { deviceId: 'hermes-host', filesystemId: '42' }

function createDatabase() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'dobius-external-reservations-')))
  directories.push(directory)
  const db = openCloudJobsDatabase(join(directory, 'jobs.sqlite'))
  databases.push(db)
  return { directory, db }
}

function ledger(db: SyncDatabase, producerId = 'monitor') {
  return createCloudWorkerExternalReservationLedger(db, {
    ...scope,
    producerId,
    now: () => 20_000
  })
}

function seedExistingQueueRows(db: SyncDatabase) {
  db.prepare('INSERT INTO cloud_projects(id, document) VALUES (?, ?)').run('project', '{}')
  db.prepare(
    `INSERT INTO cloud_jobs
     (id, creator, request_key, fingerprint, state, target, created_at, document)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('job', 'creator', 'request', 'fingerprint', 'running', scope.deviceId, 10, '{}')
  db.prepare(
    'INSERT INTO cloud_capacity_reservations(job_id, device_id, bytes, created_at) VALUES (?, ?, ?, ?)'
  ).run('job', scope.deviceId, 700, 10)
}

function queueRows(db: SyncDatabase) {
  return db
    .prepare(
      'SELECT job_id, device_id, bytes, created_at FROM cloud_capacity_reservations ORDER BY job_id'
    )
    .all()
}

afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close()
  }
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('shared external worker reservation ledger', () => {
  it('serializes competing compare-and-swap reservations across database connections', () => {
    const { directory, db } = createDatabase()
    const second = openCloudJobsDatabase(join(directory, 'jobs.sqlite'))
    databases.push(second)
    const firstLedger = ledger(db)
    const secondLedger = ledger(second, 'workspace-build')

    expect(
      firstLedger.reserve({
        ...scope,
        reservationId: 'sample-a',
        bytes: 120,
        expectedRevision: 0
      })
    ).toEqual({ revision: 1, changed: true })
    expect(() =>
      secondLedger.reserve({
        ...scope,
        reservationId: 'build-a',
        bytes: 150,
        expectedRevision: 0
      })
    ).toThrow('revision changed')
    expect(firstLedger.readSnapshot()).toMatchObject({ revision: 1, reservedBytes: 120 })
  })

  it('reads a post-sample reservation inside the caller transaction without nesting and leaves rollback to caller', () => {
    const { directory, db } = createDatabase()
    const second = openCloudJobsDatabase(join(directory, 'jobs.sqlite'))
    databases.push(second)
    const firstLedger = ledger(db)
    const secondLedger = ledger(second, 'workspace-build')
    const earlierSample = firstLedger.readSnapshot()
    expect(earlierSample).toMatchObject({ revision: 0, reservedBytes: 0 })

    secondLedger.reserve({
      ...scope,
      reservationId: 'inserted-after-sample',
      bytes: 120,
      expectedRevision: 0
    })
    expect(earlierSample).toMatchObject({ revision: 0, reservedBytes: 0 })

    expect(() =>
      cloudTransaction(db, () => {
        db.prepare('INSERT INTO cloud_settings(key, value) VALUES (?, ?)').run(
          'scoped-read-rollback',
          'pending'
        )
        const current = firstLedger.readSnapshotWithinCallerTransaction(scope)
        expect(current).toMatchObject({ revision: 1, reservedBytes: 120 })
        throw new Error('fixture outer rollback')
      })
    ).toThrow('fixture outer rollback')
    expect(
      db.prepare('SELECT value FROM cloud_settings WHERE key=?').get('scoped-read-rollback')
    ).toBeUndefined()
    expect(() =>
      cloudTransaction(db, () =>
        firstLedger.readSnapshotWithinCallerTransaction({ ...scope, filesystemId: '43' })
      )
    ).toThrow('different device or filesystem')

    secondLedger.release({
      ...scope,
      reservationId: 'inserted-after-sample',
      expectedRevision: 1
    })
    expect(() =>
      secondLedger.reserve({
        ...scope,
        reservationId: 'inserted-after-sample',
        bytes: 120,
        expectedRevision: 2
      })
    ).toThrow('identity already exists')
    expect(firstLedger.readSnapshot()).toMatchObject({ revision: 2, reservedBytes: 0 })
  })

  it('persists active reservations and revision across a schema-v4 upgrade and reopen', () => {
    const { directory, db } = createDatabase()
    seedExistingQueueRows(db)
    const before = queueRows(db)
    db.exec('DROP TABLE cloud_external_capacity_reservations')
    db.exec('DROP TABLE cloud_external_capacity_revisions')
    db.pragma('user_version = 4')
    db.close()
    databases.splice(databases.indexOf(db), 1)

    const reopened = openCloudJobsDatabase(join(directory, 'jobs.sqlite'))
    databases.push(reopened)
    expect(reopened.pragma('user_version', { simple: true })).toBe(5)
    expect(queueRows(reopened)).toEqual(before)
    const external = ledger(reopened)
    external.reserve({
      ...scope,
      reservationId: 'persistent-a',
      bytes: 250,
      expectedRevision: 0
    })
    reopened.close()
    databases.splice(databases.indexOf(reopened), 1)

    const finalDb = openCloudJobsDatabase(join(directory, 'jobs.sqlite'))
    databases.push(finalDb)
    expect(ledger(finalDb).readSnapshot()).toMatchObject({
      availability: 'unavailable',
      reason: 'participant-coverage-unverified',
      revision: 1,
      reservedBytes: 250
    })
    expect(queueRows(finalDb)).toEqual(before)
  })

  it('keeps external totals separate from C02 queue bytes and refuses a complete-capacity claim', () => {
    const { db } = createDatabase()
    seedExistingQueueRows(db)
    const external = ledger(db)
    external.reserve({
      ...scope,
      reservationId: 'external-a',
      bytes: 80,
      expectedRevision: 0
    })

    const snapshot = external.readSnapshot()
    expect(snapshot).toEqual({
      ...scope,
      availability: 'unavailable',
      reason: 'participant-coverage-unverified',
      revision: 1,
      reservedBytes: 80,
      sampledAt: 20_000
    })
    expect('complete' in snapshot).toBe(false)
    expect(queueRows(db).map((row) => row.bytes)).toEqual([700])
  })

  it('refuses duplicate identity reuse and validates producer, device, and filesystem ownership', () => {
    const { db } = createDatabase()
    const external = ledger(db)
    external.reserve({
      ...scope,
      reservationId: 'owned-a',
      bytes: 90,
      expectedRevision: 0
    })
    expect(() =>
      external.reserve({
        ...scope,
        reservationId: 'owned-a',
        bytes: 91,
        expectedRevision: 1
      })
    ).toThrow('identity already exists')
    expect(() =>
      ledger(db, 'workspace-build').release({
        ...scope,
        reservationId: 'owned-a',
        expectedRevision: 1
      })
    ).toThrow('not owned')
    expect(() =>
      external.reserve({
        ...scope,
        deviceId: 'other-host',
        reservationId: 'wrong-device',
        bytes: 1,
        expectedRevision: 1
      })
    ).toThrow('different device or filesystem')
    expect(() =>
      external.reserve({
        ...scope,
        filesystemId: '43',
        reservationId: 'wrong-filesystem',
        bytes: 1,
        expectedRevision: 1
      })
    ).toThrow('different device or filesystem')
    expect(() => ledger(db, 'not authorized')).toThrow()
    expect(external.readSnapshot()).toMatchObject({ revision: 1, reservedBytes: 90 })
  })

  it('allows only the exact owner to release and makes an exact duplicate release idempotent', () => {
    const { db } = createDatabase()
    const external = ledger(db)
    external.reserve({
      ...scope,
      reservationId: 'release-a',
      bytes: 60,
      expectedRevision: 0
    })
    expect(
      external.release({
        ...scope,
        reservationId: 'release-a',
        expectedRevision: 1
      })
    ).toEqual({ revision: 2, changed: true })
    expect(
      external.release({
        ...scope,
        reservationId: 'release-a',
        expectedRevision: 1
      })
    ).toEqual({ revision: 2, changed: false })
    expect(external.readSnapshot()).toMatchObject({ revision: 2, reservedBytes: 0 })
  })

  it('rolls revision and reservation rows back together without changing queue reservations', () => {
    const { db } = createDatabase()
    seedExistingQueueRows(db)
    const beforeQueue = queueRows(db)
    db.exec(`CREATE TRIGGER reject_external_reservation BEFORE INSERT ON cloud_external_capacity_reservations
      BEGIN SELECT RAISE(ABORT, 'fixture rejection'); END`)

    expect(() =>
      ledger(db).reserve({
        ...scope,
        reservationId: 'rollback-a',
        bytes: 40,
        expectedRevision: 0
      })
    ).toThrow('fixture rejection')
    expect(ledger(db).readSnapshot()).toMatchObject({ revision: 0, reservedBytes: 0 })
    expect(queueRows(db)).toEqual(beforeQueue)
  })

  it('refuses unsafe byte values and exhausted revisions without partial rows', () => {
    const { db } = createDatabase()
    const external = ledger(db)
    expect(() =>
      external.reserve({
        ...scope,
        reservationId: 'unsafe-bytes',
        bytes: Number.MAX_SAFE_INTEGER + 1,
        expectedRevision: 0
      })
    ).toThrow('Reservation bytes is invalid')
    external.reserve({
      ...scope,
      reservationId: 'max-safe-bytes',
      bytes: Number.MAX_SAFE_INTEGER,
      expectedRevision: 0
    })
    expect(() =>
      external.reserve({
        ...scope,
        reservationId: 'overflow-total',
        bytes: 1,
        expectedRevision: 1
      })
    ).toThrow('total exceeds safe integer range')
    external.release({ ...scope, reservationId: 'max-safe-bytes', expectedRevision: 1 })
    db.prepare(
      'UPDATE cloud_external_capacity_revisions SET revision=? WHERE device_id=? AND filesystem_id=?'
    ).run(Number.MAX_SAFE_INTEGER, scope.deviceId, scope.filesystemId)
    expect(() =>
      external.reserve({
        ...scope,
        reservationId: 'exhausted-revision',
        bytes: 10,
        expectedRevision: Number.MAX_SAFE_INTEGER
      })
    ).toThrow('revision is exhausted')
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM cloud_external_capacity_reservations').get()?.count
    ).toBe(1)
  })
})
