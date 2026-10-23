import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../sqlite/sync-database'
import {
  CloudJobAdamReceiptRequest,
  type CloudJobAdamReceiptAck
} from '../../../shared/cloud-job-adam-receipts'
import type { CloudJobAdamResult } from './cloud-job-adam-transport'
import { append, cleanupFixtures, fixture, fixtures } from './cloud-job-adam-outbox-test-support'
import { outboxOwnerA, outboxOwnerB } from './cloud-job-adam-outbox-fixtures'
import { CloudJobAdamOutboxDrainer } from './cloud-job-adam-drainer'
import { acceptedAck, syntheticClient } from './cloud-job-adam-drainer.test-support'

afterEach(cleanupFixtures)

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

type SubmitResult = CloudJobAdamResult<CloudJobAdamReceiptAck>

function storedReceipt(db: SyncDatabase) {
  const row = db.prepare('SELECT payload_json FROM cloud_job_adam_receipt_outbox').get()
  return CloudJobAdamReceiptRequest.parse(JSON.parse(String(row?.payload_json))).receipt
}

describe('CloudJobAdamOutboxDrainer authority and shutdown', () => {
  it('leaves unclaimed rows pending without authority and retains a lease on settlement revocation', async () => {
    const beforeSubmit = fixture()
    append(beforeSubmit.db)
    let calls = 0
    let authorityReads = 0
    const denied = new CloudJobAdamOutboxDrainer(
      beforeSubmit.db,
      syntheticClient(async () => {
        calls += 1
        return { state: 'unavailable', reason: 'remote-error' }
      }),
      {
        owner: outboxOwnerA,
        now: () => 7_000,
        authorityAvailable: () => {
          authorityReads += 1
          return false
        },
        intervalMs: 100,
        maxBatch: 1
      }
    )
    await expect(denied.start()).resolves.toMatchObject({ retained: 1 })
    expect(calls).toBe(0)
    await new Promise((resolve) => setTimeout(resolve, 130))
    expect(authorityReads).toBeGreaterThanOrEqual(2)
    expect(
      beforeSubmit.db
        .prepare('SELECT state, attempt_count FROM cloud_job_adam_receipt_outbox')
        .get()
    ).toMatchObject({ state: 'pending', attempt_count: 0 })
    await denied.stop()

    const beforeSettlement = fixture()
    append(beforeSettlement.db)
    let settlementAuthorityReads = 0
    const revoked = new CloudJobAdamOutboxDrainer(
      beforeSettlement.db,
      syntheticClient(async (_binding, receipt) => ({
        state: 'accepted',
        value: acceptedAck(receipt)
      })),
      {
        owner: outboxOwnerA,
        now: () => 7_000,
        authorityAvailable: () => ++settlementAuthorityReads < 3,
        maxBatch: 1
      }
    )
    await expect(revoked.start()).resolves.toMatchObject({ retained: 1 })
    expect(settlementAuthorityReads).toBe(3)
    expect(
      beforeSettlement.db.prepare('SELECT state, ack_json FROM cloud_job_adam_receipt_outbox').get()
    ).toMatchObject({
      state: 'leased',
      ack_json: null
    })
    await revoked.stop()
  })

  it('cannot settle a stale nonce after another drainer takes over the expired lease', async () => {
    const original = fixture()
    append(original.db)
    const firstReply = deferred<SubmitResult>()
    const firstStarted = deferred<void>()
    const stale = new CloudJobAdamOutboxDrainer(
      original.db,
      syntheticClient(async () => {
        firstStarted.resolve()
        return firstReply.promise
      }),
      {
        owner: outboxOwnerA,
        now: () => 8_001,
        authorityAvailable: () => true,
        leaseMs: 1_000,
        maxBatch: 1
      }
    )
    const staleTick = stale.start()
    await firstStarted.promise

    const secondDb = new SyncDatabase(original.file)
    fixtures.push({ file: original.file, db: secondDb })
    const secondReply = deferred<void>()
    const secondStarted = deferred<void>()
    const current = new CloudJobAdamOutboxDrainer(
      secondDb,
      syntheticClient(async (_binding, receipt) => {
        secondStarted.resolve()
        await secondReply.promise
        return { state: 'accepted', value: acceptedAck(receipt, 'duplicate', 8_200) }
      }),
      {
        owner: outboxOwnerB,
        now: () => 9_002,
        authorityAvailable: () => true,
        leaseMs: 1_000,
        maxBatch: 1
      }
    )
    const currentTick = current.start()
    await secondStarted.promise
    firstReply.resolve({
      state: 'accepted',
      value: acceptedAck(storedReceipt(original.db), 'inserted', 8_100)
    })
    await expect(staleTick).resolves.toMatchObject({ retained: 1 })
    expect(
      secondDb.prepare('SELECT state, lease_owner FROM cloud_job_adam_receipt_outbox').get()
    ).toMatchObject({
      state: 'leased',
      lease_owner: outboxOwnerB
    })
    secondReply.resolve()
    await expect(currentTick).resolves.toMatchObject({ acknowledged: 1 })
    expect(secondDb.prepare('SELECT state FROM cloud_job_adam_receipt_outbox').get()?.state).toBe(
      'acked'
    )
    await stale.stop()
    await current.stop()
  })

  it('fences stop synchronously and does not write after a bounded shutdown timeout', async () => {
    const { db } = fixture()
    append(db)
    const reply = deferred<SubmitResult>()
    const started = deferred<void>()
    let calls = 0
    const drainer = new CloudJobAdamOutboxDrainer(
      db,
      syntheticClient(async () => {
        calls += 1
        started.resolve()
        return reply.promise
      }),
      { owner: outboxOwnerA, now: () => 7_000, authorityAvailable: () => true, maxBatch: 1 }
    )
    const tick = drainer.start()
    await started.promise
    const stopped = drainer.stop(0)
    await expect(stopped).resolves.toBe('timed-out')
    reply.resolve({
      state: 'accepted',
      value: acceptedAck(storedReceipt(db), 'inserted')
    })
    await expect(tick).resolves.toMatchObject({ retained: 1 })
    expect(
      db.prepare('SELECT state, ack_json FROM cloud_job_adam_receipt_outbox').get()
    ).toMatchObject({
      state: 'leased',
      ack_json: null
    })
    expect(calls).toBe(1)
    expect(() => drainer.start()).toThrow(/already been started/)
    await expect(drainer.stop()).resolves.toBe('drained')
  })

  it('owns the active tick before reentrant stop and waits until its settlement is finished', async () => {
    const { db } = fixture()
    append(db)
    const reply = deferred<SubmitResult>()
    const submitted = deferred<void>()
    let stopPromise: Promise<'drained' | 'timed-out'> | undefined
    let drainer!: CloudJobAdamOutboxDrainer
    drainer = new CloudJobAdamOutboxDrainer(
      db,
      syntheticClient(async () => {
        stopPromise = drainer.stop(500)
        submitted.resolve()
        return reply.promise
      }),
      {
        owner: outboxOwnerA,
        now: () => 7_000,
        authorityAvailable: () => true,
        intervalMs: 60_000,
        maxBatch: 1
      }
    )
    const tick = drainer.start()
    await submitted.promise
    let stopSettled = false
    void stopPromise!.then(() => {
      stopSettled = true
    })
    await Promise.resolve()
    expect(stopSettled).toBe(false)

    reply.resolve({ state: 'accepted', value: acceptedAck(storedReceipt(db), 'inserted') })
    await expect(tick).resolves.toMatchObject({ acknowledged: 1 })
    await expect(stopPromise).resolves.toBe('drained')
    const ackAtDrain = db.prepare('SELECT state, ack_json FROM cloud_job_adam_receipt_outbox').get()
    expect(ackAtDrain?.state).toBe('acked')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(db.prepare('SELECT state, ack_json FROM cloud_job_adam_receipt_outbox').get()).toEqual(
      ackAtDrain
    )
  })

  it('keeps stop-before-start terminal, including a zero-millisecond shutdown bound', async () => {
    const { db } = fixture()
    append(db)
    let calls = 0
    const drainer = new CloudJobAdamOutboxDrainer(
      db,
      syntheticClient(async () => {
        calls += 1
        return { state: 'unavailable', reason: 'remote-error' }
      }),
      { owner: outboxOwnerA, now: () => 7_000, authorityAvailable: () => true, maxBatch: 1 }
    )

    await expect(drainer.stop(0)).resolves.toBe('drained')
    expect(() => drainer.start()).toThrow(/already been started/)
    expect(calls).toBe(0)
    expect(db.prepare('SELECT state FROM cloud_job_adam_receipt_outbox').get()?.state).toBe(
      'pending'
    )
  })
})
