import { afterEach, describe, expect, it } from 'vitest'
import SyncDatabase from '../../sqlite/sync-database'
import { CloudJobAdamReceiptAck } from '../../../shared/cloud-job-adam-receipts'
import {
  acknowledgeCloudJobAdamReceipt,
  claimNextCloudJobAdamReceipt,
  recordCloudJobAdamReceiptFailure
} from './cloud-job-adam-outbox-lease'
import { cloudJobAdamOutboxStatus } from './cloud-job-adam-outbox'
import {
  outboxBindingId,
  outboxJobId,
  outboxOwnerA,
  outboxOwnerB
} from './cloud-job-adam-outbox-fixtures'
import {
  append,
  appendSecondEvent,
  cleanupFixtures,
  fixtures,
  fixture
} from './cloud-job-adam-outbox-test-support'

afterEach(cleanupFixtures)

describe('CloudJob ADAM receipt outbox lease and recovery', () => {
  it('serializes two drainers, recovers an expired lease, rejects a stale owner, then advances on exact ack', () => {
    const { db, file } = fixture()
    append(db)
    appendSecondEvent(db)
    const secondDb = new SyncDatabase(file)
    const second = { db: secondDb, file }
    fixtures.push(second)
    const firstClaim = claimNextCloudJobAdamReceipt(db, {
      bindingId: outboxBindingId,
      owner: outboxOwnerA,
      nowMs: 7_000,
      leaseMs: 2_000
    })
    expect(firstClaim.state).toBe('claimed')
    if (firstClaim.state !== 'claimed') {
      return
    }
    expect(firstClaim.request.receipt.cloudEventSequence).toBe(1)
    expect(
      claimNextCloudJobAdamReceipt(secondDb, {
        bindingId: outboxBindingId,
        owner: outboxOwnerB,
        nowMs: 7_001,
        leaseMs: 2_000
      })
    ).toEqual({ state: 'leased' })

    fixtures.splice(
      fixtures.findIndex((item) => item.db === secondDb),
      1
    )
    secondDb.close()
    const reopened = new SyncDatabase(file)
    fixtures.push({ file, db: reopened })
    expect(
      claimNextCloudJobAdamReceipt(reopened, {
        bindingId: outboxBindingId,
        owner: outboxOwnerB,
        nowMs: 9_001,
        leaseMs: 2_000
      })
    ).toMatchObject({ state: 'claimed', receiptId: firstClaim.receiptId, owner: outboxOwnerB })
    const takeover = claimNextCloudJobAdamReceipt(reopened, {
      bindingId: outboxBindingId,
      owner: outboxOwnerB,
      nowMs: 9_002,
      leaseMs: 2_000
    })
    expect(takeover).toEqual({ state: 'leased' })
    expect(() =>
      acknowledgeCloudJobAdamReceipt(reopened, {
        receiptId: firstClaim.receiptId,
        owner: outboxOwnerA,
        nonce: firstClaim.nonce,
        ack: CloudJobAdamReceiptAck.parse({
          schemaVersion: 1,
          ok: true,
          receiptId: firstClaim.receiptId,
          payloadSha256: firstClaim.request.payloadSha256,
          accepted: 'inserted',
          storedAtMs: 9_003,
          parentStateChanged: false
        }),
        nowMs: 9_003
      })
    ).toThrow(/stale or no longer owned/)

    const active = reopened
      .prepare('SELECT lease_nonce FROM cloud_job_adam_receipt_outbox WHERE receipt_id=?')
      .get(firstClaim.receiptId)
    const currentNonce = String(active?.lease_nonce)
    const ack = {
      schemaVersion: 1 as const,
      ok: true as const,
      receiptId: firstClaim.receiptId,
      payloadSha256: firstClaim.request.payloadSha256,
      accepted: 'inserted' as const,
      storedAtMs: 9_004,
      parentStateChanged: false as const
    }
    expect(
      acknowledgeCloudJobAdamReceipt(reopened, {
        receiptId: firstClaim.receiptId,
        owner: outboxOwnerB,
        nonce: currentNonce,
        ack,
        nowMs: 9_004
      })
    ).toBe('acked')
    expect(
      acknowledgeCloudJobAdamReceipt(reopened, {
        receiptId: firstClaim.receiptId,
        owner: outboxOwnerA,
        nonce: firstClaim.nonce,
        ack,
        nowMs: 9_005
      })
    ).toBe('duplicate')
    expect(() =>
      acknowledgeCloudJobAdamReceipt(reopened, {
        receiptId: firstClaim.receiptId,
        owner: outboxOwnerA,
        nonce: firstClaim.nonce,
        ack: { ...ack, storedAtMs: ack.storedAtMs + 1 },
        nowMs: 9_005
      })
    ).toThrow(/conflicts with the durable acknowledgement/)
    const next = claimNextCloudJobAdamReceipt(reopened, {
      bindingId: outboxBindingId,
      owner: outboxOwnerA,
      nowMs: 9_006,
      leaseMs: 2_000
    })
    expect(next).toMatchObject({
      state: 'claimed',
      request: { receipt: { cloudEventSequence: 2 } }
    })
  })

  it('keeps later receipts blocked behind an auth or conflict failure and exposes redacted counts', () => {
    const { db } = fixture()
    append(db)
    appendSecondEvent(db)
    const claim = claimNextCloudJobAdamReceipt(db, {
      bindingId: outboxBindingId,
      owner: outboxOwnerA,
      nowMs: 7_000,
      leaseMs: 2_000
    })
    expect(claim.state).toBe('claimed')
    if (claim.state !== 'claimed') {
      return
    }
    expect(
      recordCloudJobAdamReceiptFailure(db, {
        receiptId: claim.receiptId,
        owner: claim.owner,
        nonce: claim.nonce,
        failure: 'unauthorized',
        nowMs: 7_001
      })
    ).toBe('blocked')
    expect(
      claimNextCloudJobAdamReceipt(db, {
        bindingId: outboxBindingId,
        owner: outboxOwnerB,
        nowMs: 7_002,
        leaseMs: 2_000
      })
    ).toEqual({ state: 'blocked' })
    const status = cloudJobAdamOutboxStatus(db)
    expect(status).toEqual({ pending: 1, leased: 0, acked: 0, blocked: 1, total: 2 })
    expect(JSON.stringify(status)).not.toContain(outboxBindingId)
    expect(JSON.stringify(status)).not.toContain(outboxJobId)
  })

  it('retries transient failures with bounded backoff and rejects stale lease owners', () => {
    const { db } = fixture()
    append(db)
    const claim = claimNextCloudJobAdamReceipt(db, {
      bindingId: outboxBindingId,
      owner: outboxOwnerA,
      nowMs: 7_000,
      leaseMs: 2_000
    })
    expect(claim.state).toBe('claimed')
    if (claim.state !== 'claimed') {
      return
    }
    expect(
      recordCloudJobAdamReceiptFailure(db, {
        receiptId: claim.receiptId,
        owner: claim.owner,
        nonce: claim.nonce,
        failure: 'timeout',
        nowMs: 7_001
      })
    ).toBe('retry')
    expect(
      claimNextCloudJobAdamReceipt(db, {
        bindingId: outboxBindingId,
        owner: outboxOwnerB,
        nowMs: 7_500,
        leaseMs: 2_000
      })
    ).toEqual({ state: 'not-due' })
    const retry = claimNextCloudJobAdamReceipt(db, {
      bindingId: outboxBindingId,
      owner: outboxOwnerB,
      nowMs: 8_001,
      leaseMs: 2_000
    })
    expect(retry).toMatchObject({ state: 'claimed', deliveryAttempt: 2 })
    expect(() =>
      recordCloudJobAdamReceiptFailure(db, {
        receiptId: claim.receiptId,
        owner: outboxOwnerA,
        nonce: claim.nonce,
        failure: 'timeout',
        nowMs: 8_002
      })
    ).toThrow(/stale or no longer owned/)
  })
})
