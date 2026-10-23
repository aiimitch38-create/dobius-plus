import { CloudId } from '../../../shared/cloud-jobs'
import { WorkerId } from '../../../shared/workstation-worker'
import type SyncDatabase from '../../sqlite/sync-database'
import { cloudTransaction } from './database'

const MAX_SAFE = Number.MAX_SAFE_INTEGER
const FILESYSTEM_ID = /^(0|[1-9][0-9]*)$/

export type ExternalReservationScope = {
  deviceId: string
  filesystemId: string
}

export type ExternalReservationLedgerOptions = ExternalReservationScope & {
  /** This handle owns one producer identity; operations cannot impersonate another producer. */
  producerId: string
  now?: () => number
}

export type ExternalReservationMutation = {
  revision: number
  changed: boolean
}

export type ExternalReservationLedgerSnapshot = ExternalReservationScope & {
  availability: 'unavailable'
  reason: 'participant-coverage-unverified'
  revision: number
  reservedBytes: number
  sampledAt: number
}

export class ExternalReservationRevisionConflict extends Error {
  constructor(
    readonly expectedRevision: number,
    readonly currentRevision: number
  ) {
    super(
      `External reservation revision changed (expected ${expectedRevision}, current ${currentRevision}).`
    )
    this.name = 'ExternalReservationRevisionConflict'
  }
}

/**
 * Stores producer reservations in the cloud-jobs SQLite authority. This is a
 * ledger foundation only: it cannot attest that every disk writer participates.
 */
export function createCloudWorkerExternalReservationLedger(
  db: SyncDatabase,
  options: ExternalReservationLedgerOptions
) {
  const scope = validateScope(options)
  const producerId = parseProducerId(options.producerId)
  const now = options.now ?? Date.now
  const readSnapshotValue = (): ExternalReservationLedgerSnapshot => {
    const revision = currentRevision(db, scope)
    return {
      ...scope,
      availability: 'unavailable',
      reason: 'participant-coverage-unverified',
      revision,
      reservedBytes: activeReservedBytes(db, scope),
      sampledAt: readClock(now)
    }
  }

  return {
    reserve(
      input: ExternalReservationScope & {
        reservationId: string
        bytes: number
        expectedRevision: number
      }
    ): ExternalReservationMutation {
      const identity = validateMutation(input, scope, producerId)
      assertSafeInteger(input.bytes, 'Reservation bytes', 0)
      assertRevision(input.expectedRevision)
      const createdAt = readClock(now)

      return cloudTransaction(db, () => {
        const current = currentRevision(db, scope)
        assertExpectedRevision(input.expectedRevision, current)
        if (
          db
            .prepare(
              'SELECT 1 AS found FROM cloud_external_capacity_reservations WHERE producer_id=? AND reservation_id=?'
            )
            .get(identity.producerId, identity.reservationId)
        ) {
          throw new Error(
            'External reservation identity already exists; identities cannot be reused.'
          )
        }
        const activeBytes = activeReservedBytes(db, scope)
        if (activeBytes > MAX_SAFE - input.bytes) {
          throw new Error('External reservation total exceeds safe integer range.')
        }
        const revision = advanceRevision(db, scope, current)
        db.prepare(
          `INSERT INTO cloud_external_capacity_reservations
           (producer_id, reservation_id, device_id, filesystem_id, bytes, created_at, created_revision)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          identity.producerId,
          identity.reservationId,
          scope.deviceId,
          scope.filesystemId,
          input.bytes,
          createdAt,
          revision
        )
        return { revision, changed: true }
      })
    },

    release(
      input: ExternalReservationScope & {
        reservationId: string
        expectedRevision: number
      }
    ): ExternalReservationMutation {
      const identity = validateMutation(input, scope, producerId)
      assertRevision(input.expectedRevision)
      const releasedAt = readClock(now)

      return cloudTransaction(db, () => {
        const row = db
          .prepare(
            `SELECT device_id, filesystem_id, released_revision
             FROM cloud_external_capacity_reservations WHERE producer_id=? AND reservation_id=?`
          )
          .get(identity.producerId, identity.reservationId)
        if (!row) {
          throw new Error('External reservation is not owned by this producer.')
        }
        if (row.device_id !== scope.deviceId || row.filesystem_id !== scope.filesystemId) {
          throw new Error('External reservation belongs to a different device or filesystem.')
        }
        const current = currentRevision(db, scope)
        if (row.released_revision !== null && row.released_revision !== undefined) {
          return { revision: current, changed: false }
        }
        assertExpectedRevision(input.expectedRevision, current)
        const revision = advanceRevision(db, scope, current)
        const result = db
          .prepare(
            `UPDATE cloud_external_capacity_reservations
             SET released_at=?, released_revision=?
             WHERE producer_id=? AND reservation_id=? AND released_revision IS NULL`
          )
          .run(releasedAt, revision, identity.producerId, identity.reservationId)
        if (Number(result.changes) !== 1) {
          throw new Error('External reservation release changed concurrently.')
        }
        return { revision, changed: true }
      })
    },

    readSnapshot(): ExternalReservationLedgerSnapshot {
      return cloudTransaction(db, readSnapshotValue)
    },

    /**
     * Reads within a caller-owned cloudTransaction/BEGIN IMMEDIATE without nesting.
     * SyncDatabase cannot prove a transaction is active, so callers own that precondition.
     */
    readSnapshotWithinCallerTransaction(
      requestedScope: ExternalReservationScope
    ): ExternalReservationLedgerSnapshot {
      assertSameScope(validateScope(requestedScope), scope)
      return readSnapshotValue()
    }
  }
}

function activeReservedBytes(db: SyncDatabase, scope: ExternalReservationScope): number {
  const rows = db
    .prepare(
      `SELECT bytes FROM cloud_external_capacity_reservations
       WHERE device_id=? AND filesystem_id=? AND released_revision IS NULL`
    )
    .all(scope.deviceId, scope.filesystemId)
  return sumSafeBytes(rows.map((entry) => Number(entry.bytes)))
}

function validateScope(input: ExternalReservationScope): ExternalReservationScope {
  const deviceId = WorkerId.parse(input.deviceId)
  if (typeof input.filesystemId !== 'string' || !FILESYSTEM_ID.test(input.filesystemId)) {
    throw new Error('External reservation filesystem identity is invalid.')
  }
  return { deviceId, filesystemId: input.filesystemId }
}

function parseProducerId(value: string): string {
  return CloudId.parse(value)
}

function validateMutation(
  input: ExternalReservationScope & { reservationId: string },
  scope: ExternalReservationScope,
  producerId: string
) {
  assertSameScope(input, scope)
  return { producerId, reservationId: CloudId.parse(input.reservationId) }
}

function assertSameScope(
  requested: ExternalReservationScope,
  bound: ExternalReservationScope
): void {
  if (requested.deviceId !== bound.deviceId || requested.filesystemId !== bound.filesystemId) {
    throw new Error('External reservation request targets a different device or filesystem.')
  }
}

function currentRevision(db: SyncDatabase, scope: ExternalReservationScope): number {
  const row = db
    .prepare(
      'SELECT revision FROM cloud_external_capacity_revisions WHERE device_id=? AND filesystem_id=?'
    )
    .get(scope.deviceId, scope.filesystemId)
  if (!row) {
    return 0
  }
  const revision = Number(row.revision)
  assertRevision(revision)
  return revision
}

function advanceRevision(
  db: SyncDatabase,
  scope: ExternalReservationScope,
  current: number
): number {
  if (current === MAX_SAFE) {
    throw new Error('External reservation revision is exhausted.')
  }
  const next = current + 1
  if (current === 0) {
    db.prepare(
      'INSERT INTO cloud_external_capacity_revisions(device_id, filesystem_id, revision) VALUES (?, ?, ?)'
    ).run(scope.deviceId, scope.filesystemId, next)
    return next
  }
  const result = db
    .prepare(
      `UPDATE cloud_external_capacity_revisions SET revision=?
       WHERE device_id=? AND filesystem_id=? AND revision=?`
    )
    .run(next, scope.deviceId, scope.filesystemId, current)
  if (Number(result.changes) !== 1) {
    throw new ExternalReservationRevisionConflict(current, currentRevision(db, scope))
  }
  return next
}

function assertExpectedRevision(expected: number, current: number): void {
  if (expected !== current) {
    throw new ExternalReservationRevisionConflict(expected, current)
  }
}

function assertRevision(value: number): void {
  assertSafeInteger(value, 'External reservation revision', 0)
}

function assertSafeInteger(value: number, name: string, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} is invalid.`)
  }
}

function readClock(now: () => number): number {
  const value = now()
  assertSafeInteger(value, 'External reservation clock', 0)
  return value
}

function sumSafeBytes(values: readonly number[]): number {
  let total = 0
  for (const value of values) {
    assertSafeInteger(value, 'Stored external reservation bytes', 0)
    if (total > MAX_SAFE - value) {
      throw new Error('External reservation total exceeds safe integer range.')
    }
    total += value
  }
  return total
}
