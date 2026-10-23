import { afterEach, describe, expect, it } from 'vitest'
import { canonicalCloudJobAdamSha256 } from '../../../shared/cloud-job-adam-receipts'
import {
  appendCloudJobAdamReceiptInTransaction,
  cloudJobAdamOutboxStatus,
  recordCloudJobAdamBindingInTransaction
} from './cloud-job-adam-outbox'
import {
  outboxBinding,
  outboxBindingId,
  outboxJobId,
  outboxReceipt
} from './cloud-job-adam-outbox-fixtures'
import { cloudJobAdamOutboxMigrationDDL } from './cloud-job-adam-outbox-schema'
import {
  append,
  appendSecondEvent,
  cleanupFixtures,
  fixture,
  transaction
} from './cloud-job-adam-outbox-test-support'

afterEach(cleanupFixtures)

describe('CloudJob ADAM receipt outbox schema and append', () => {
  it('exposes migration DDL and stores immutable binding identity without capability material', () => {
    const { db } = fixture()
    expect(cloudJobAdamOutboxMigrationDDL()).toContain('cloud_job_adam_receipt_outbox')
    expect(
      db
        .prepare(
          'SELECT binding_id, binding_digest, request_fingerprint FROM cloud_job_adam_bindings'
        )
        .get()
    ).toMatchObject({
      binding_id: outboxBindingId,
      binding_digest: outboxBinding().bindingDigest,
      request_fingerprint: outboxBinding().binding.requestFingerprint
    })
    const columns = db
      .prepare('PRAGMA table_info(cloud_job_adam_bindings)')
      .all()
      .map((row) => row.name)
    expect(columns).not.toContain('capability')
    expect(columns).not.toContain('token')
    expect(() =>
      recordCloudJobAdamBindingInTransaction(db, {
        jobId: outboxJobId,
        bindingResponse: outboxBinding(),
        nowMs: 6_000
      })
    ).toThrow(/existing SQLite transaction/)

    expect(
      transaction(db, () =>
        recordCloudJobAdamBindingInTransaction(db, {
          jobId: outboxJobId,
          bindingResponse: outboxBinding(),
          nowMs: 10_000
        })
      )
    ).toBe('duplicate')
    const changed = outboxBinding()
    const binding = { ...changed.binding, contextDigest: 'e'.repeat(64) }
    const changedResponse = {
      ...changed,
      binding,
      bindingDigest: canonicalCloudJobAdamSha256(binding)
    }
    expect(() =>
      transaction(db, () =>
        recordCloudJobAdamBindingInTransaction(db, {
          jobId: outboxJobId,
          bindingResponse: changedResponse,
          nowMs: 6_000
        })
      )
    ).toThrow(/immutable link/)
  })

  it('requires a fresh binding grant for insertion but permits exact expired-link replay', () => {
    const { db } = fixture()
    expect(
      transaction(db, () =>
        recordCloudJobAdamBindingInTransaction(db, {
          jobId: outboxJobId,
          bindingResponse: outboxBinding(),
          nowMs: 9_000
        })
      )
    ).toBe('duplicate')

    db.prepare('DELETE FROM cloud_job_adam_bindings WHERE job_id=?').run(outboxJobId)
    expect(() =>
      transaction(db, () =>
        recordCloudJobAdamBindingInTransaction(db, {
          jobId: outboxJobId,
          bindingResponse: outboxBinding(),
          nowMs: 9_000
        })
      )
    ).toThrow(/fresh and unexpired/)
  })

  it('appends only an exact event and makes exact replay idempotent after later job versions', () => {
    const { db } = fixture()
    const receipt = outboxReceipt()
    expect(() =>
      appendCloudJobAdamReceiptInTransaction(db, {
        jobId: outboxJobId,
        receipt,
        nowMs: 6_000
      })
    ).toThrow(/existing SQLite transaction/)
    expect(() => append(db, { ...receipt, cloudJobVersion: 4 })).toThrow(
      /exact committed cloud job event/
    )
    expect(() =>
      append(db, { ...receipt, attemptId: '34b55f0d-6632-4a9b-bcf9-4d140fd0a3e8' })
    ).toThrow(/durable CloudJob ledger proof/)
    expect(() =>
      append(db, { ...receipt, bindingId: '1fbf22da-9ab1-478a-a44f-19d661a820d4' })
    ).toThrow(/immutable job binding/)
    expect(append(db, receipt).state).toBe('inserted')
    appendSecondEvent(db)
    expect(append(db, receipt).state).toBe('duplicate')
    expect(() => append(db, { ...receipt, contextDigest: 'e'.repeat(64) })).toThrow(
      /immutable job binding/
    )
    expect(() =>
      append(db, { ...receipt, attemptId: '34b55f0d-6632-4a9b-bcf9-4d140fd0a3e8' })
    ).toThrow(/conflicts with different content/)
    expect(cloudJobAdamOutboxStatus(db)).toEqual({
      pending: 2,
      leased: 0,
      acked: 0,
      blocked: 0,
      total: 2
    })
  })
})
