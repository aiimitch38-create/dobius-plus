import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../sqlite/sync-database'
import {
  cleanupFixtures,
  append,
  appendSecondEvent,
  fixture,
  fixtures
} from './cloud-job-adam-outbox-test-support'
import { outboxOwnerA, outboxOwnerB } from './cloud-job-adam-outbox-fixtures'
import { CloudJobAdamOutboxDrainer } from './cloud-job-adam-drainer'
import { acceptedAck, syntheticClient } from './cloud-job-adam-drainer.test-support'

afterEach(cleanupFixtures)

const authority = () => true

describe('CloudJobAdamOutboxDrainer ordering and replay', () => {
  it('sends each binding oldest-first and stores exact receipt acknowledgements', async () => {
    const { db } = fixture()
    append(db)
    appendSecondEvent(db)
    const sent: { receiptId: string; sequence: number; digest: string }[] = []
    const drainer = new CloudJobAdamOutboxDrainer(
      db,
      syntheticClient(async (_binding, receipt) => {
        sent.push({
          receiptId: receipt.receiptId,
          sequence: receipt.cloudEventSequence,
          digest: acceptedAck(receipt).payloadSha256
        })
        return { state: 'accepted', value: acceptedAck(receipt) }
      }),
      { owner: outboxOwnerA, now: () => 7_000, authorityAvailable: authority, maxBatch: 4 }
    )

    await expect(drainer.start()).resolves.toMatchObject({ state: 'completed', acknowledged: 2 })
    expect(sent.map(({ sequence }) => sequence)).toEqual([1, 2])
    expect(new Set(sent.map(({ receiptId }) => receiptId)).size).toBe(2)
    const rows = db
      .prepare(
        'SELECT receipt_id, payload_sha256, state, ack_json FROM cloud_job_adam_receipt_outbox ORDER BY cloud_event_sequence'
      )
      .all()
    expect(rows).toHaveLength(2)
    for (const [index, row] of rows.entries()) {
      expect(row.state).toBe('acked')
      expect(row.receipt_id).toBe(sent[index]!.receiptId)
      expect(row.payload_sha256).toBe(sent[index]!.digest)
      expect(JSON.parse(String(row.ack_json))).toMatchObject({
        receiptId: row.receipt_id,
        payloadSha256: row.payload_sha256
      })
    }
    await expect(drainer.stop()).resolves.toBe('drained')
  })

  it('reopens the same outbox and replays the original receipt ID and digest after an unknown timeout', async () => {
    const original = fixture()
    append(original.db)
    const first = new CloudJobAdamOutboxDrainer(
      original.db,
      syntheticClient(async () => ({ state: 'unavailable', reason: 'timeout' })),
      {
        owner: outboxOwnerA,
        now: () => 7_000,
        authorityAvailable: authority,
        leaseMs: 1_000,
        maxBatch: 1
      }
    )
    await expect(first.start()).resolves.toMatchObject({ retained: 1 })
    await expect(first.stop()).resolves.toBe('drained')
    const before = original.db
      .prepare('SELECT receipt_id, payload_sha256, state FROM cloud_job_adam_receipt_outbox')
      .get()
    expect(before?.state).toBe('leased')

    const position = fixtures.findIndex((item) => item.db === original.db)
    fixtures.splice(position, 1)
    original.db.close()
    const reopened = new SyncDatabase(original.file)
    fixtures.push({ file: original.file, db: reopened })
    let replayed: { receiptId: string; digest: string } | undefined
    const second = new CloudJobAdamOutboxDrainer(
      reopened,
      syntheticClient(async (_binding, receipt) => {
        replayed = {
          receiptId: receipt.receiptId,
          digest: acceptedAck(receipt).payloadSha256
        }
        return { state: 'accepted', value: acceptedAck(receipt, 'duplicate', 8_100) }
      }),
      {
        owner: outboxOwnerB,
        now: () => 8_001,
        authorityAvailable: authority,
        leaseMs: 1_000,
        maxBatch: 1
      }
    )
    await expect(second.start()).resolves.toMatchObject({ acknowledged: 1 })
    expect(replayed).toEqual({ receiptId: before?.receipt_id, digest: before?.payload_sha256 })
    expect(reopened.prepare('SELECT state FROM cloud_job_adam_receipt_outbox').get()?.state).toBe(
      'acked'
    )
    await second.stop()
  })

  it('maps known remote failures to bounded retry state and retries the same durable receipt', async () => {
    const { db } = fixture()
    append(db)
    const first = new CloudJobAdamOutboxDrainer(
      db,
      syntheticClient(async () => ({ state: 'unavailable', reason: 'remote-error' })),
      { owner: outboxOwnerA, now: () => 7_000, authorityAvailable: authority, maxBatch: 1 }
    )
    await expect(first.start()).resolves.toMatchObject({ retried: 1 })
    await first.stop()
    const row = db
      .prepare('SELECT receipt_id, payload_sha256, state FROM cloud_job_adam_receipt_outbox')
      .get()
    expect(row?.state).toBe('pending')

    let replay: { receiptId: string; digest: string } | undefined
    const retry = new CloudJobAdamOutboxDrainer(
      db,
      syntheticClient(async (_binding, receipt) => {
        replay = { receiptId: receipt.receiptId, digest: acceptedAck(receipt).payloadSha256 }
        return { state: 'accepted', value: acceptedAck(receipt, 'duplicate', 8_100) }
      }),
      { owner: outboxOwnerB, now: () => 8_001, authorityAvailable: authority, maxBatch: 1 }
    )
    await expect(retry.start()).resolves.toMatchObject({ acknowledged: 1 })
    expect(replay).toEqual({ receiptId: row?.receipt_id, digest: row?.payload_sha256 })
    await retry.stop()
  })
})
