import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { openDatabase } from '../src/db/database.js'
import { JobStore } from '../src/jobs/store.js'
import { CloudReceiptError, DobiusCloudReceiptStore } from '../src/dobius-cloud/receipt-store.js'
import { canonicalCloudJobAdamSha256 } from '../src/dobius-cloud/receipt-contract.js'

const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup() })
function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'adam-cloud-receipts-'))
  const file = join(base, 'database.sqlite')
  const db = openDatabase(file)
  const jobs = new JobStore(db)
  const parent = jobs.createJob({ objective: 'Synthetic parent', projectId: 'project' })
  let now = 100_000
  const store = new DobiusCloudReceiptStore(db, () => now)
  const grant = store.issueGrant({ parentObjectiveId: parent, parentObjectiveVersion: 1,
    projectId: 'project', contextDigest: 'a'.repeat(64), requestFingerprint: 'b'.repeat(64), ttlMs: 1000 })
  const { capability, ...binding } = grant
  const request = { schemaVersion: 1, capability, binding }
  const receipt = { schemaVersion: 1, receiptId: randomUUID(), bindingId: binding.bindingId,
    adamInstanceId: store.instanceId, parentObjectiveId: parent, parentObjectiveVersion: 1,
    cloudJobId: randomUUID(), cloudJobVersion: 1, cloudEventSequence: 1, attemptId: null,
    attemptNumber: null, eventKind: 'submitted', cloudJobState: 'queued', projectId: 'project',
    contextDigest: 'a'.repeat(64), evidenceDigests: [], occurredAtMs: now }
  cleanups.push(() => { db.close(); rmSync(base, { recursive: true, force: true }) })
  return { base, file, db, jobs, parent, store, request, grant, receipt,
    advance: (ms: number) => { now += ms },
    packet: (value: unknown = receipt) => ({ schemaVersion: 1, receipt: value, payloadSha256: canonicalCloudJobAdamSha256(value) }) }
}

describe('ADAM child-job receipt receiver', () => {
  it('stores only capability hashes and keeps consumption idempotent', () => {
    const f = fixture()
    const one = f.store.consume(f.request)
    f.advance(2000)
    assert.deepEqual(f.store.consume(f.request), one)
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM dobius_cloud_bindings').get()!.n, 1)
    assert.equal(readFileSync(f.file).includes(Buffer.from(f.grant.capability)), false)
    assert.equal(JSON.stringify(one).includes(f.grant.capability), false)
    assert.equal(f.db.prepare('PRAGMA synchronous').get()!.synchronous, 2)
  })

  it('refuses mismatched capability, parent context and expired first consumption', () => {
    const f = fixture()
    assert.throws(() => f.store.consume({ ...f.request, capability: 'x'.repeat(43) }), CloudReceiptError)
    assert.throws(() => f.store.consume({ ...f.request, binding: { ...f.request.binding, contextDigest: 'c'.repeat(64) } }), CloudReceiptError)
    f.advance(1000)
    assert.throws(() => f.store.consume(f.request), (error: unknown) => error instanceof CloudReceiptError && error.code === 'expired')
    assert.equal(f.db.prepare('SELECT consumed_at_ms FROM dobius_cloud_bindings').get()!.consumed_at_ms, null)
  })

  it('rejects a parent revision changed before first consumption', () => {
    const f = fixture()
    f.db.prepare("UPDATE jobs SET objective='Changed synthetic objective' WHERE id=?").run(f.parent)
    assert.throws(() => f.store.consume(f.request), (error: unknown) => error instanceof CloudReceiptError && error.code === 'conflict')
  })

  it('durably acknowledges exact replay without completing its parent', () => {
    const f = fixture()
    f.store.consume(f.request)
    const before = f.jobs.getJob(f.parent)
    const ack = f.store.receive(f.packet())
    assert.equal(ack.parentStateChanged, false)
    const reopened = new DobiusCloudReceiptStore(f.db, () => 101_000)
    assert.equal(reopened.instanceId, f.store.instanceId)
    assert.equal(reopened.receive(f.packet()).accepted, 'duplicate')
    assert.deepEqual(f.jobs.getJob(f.parent), before)
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM dobius_cloud_receipts').get()!.n, 1)
    const successfulChild = { ...f.receipt, receiptId: randomUUID(), cloudEventSequence: 2,
      cloudJobVersion: 2, attemptId: randomUUID(), attemptNumber: 1,
      eventKind: 'execution_needs_review', cloudJobState: 'needs_review' }
    f.store.receive(f.packet(successfulChild))
    assert.deepEqual(f.jobs.getJob(f.parent), before)
  })

  it('rejects changed receipt replay, digest mismatch, misbound parent and reversed ordering', () => {
    const f = fixture()
    f.store.consume(f.request)
    const newer = { ...f.receipt, cloudEventSequence: 2 }
    f.store.receive(f.packet(newer))
    assert.throws(() => f.store.receive(f.packet({ ...newer, occurredAtMs: 90_000 })), CloudReceiptError)
    assert.throws(() => f.store.receive({ ...f.packet(), payloadSha256: '0'.repeat(64) }), CloudReceiptError)
    assert.throws(() => f.store.receive(f.packet({ ...f.receipt, parentObjectiveId: randomUUID(), receiptId: randomUUID() })), CloudReceiptError)
    assert.throws(() => f.store.receive(f.packet({ ...f.receipt, receiptId: randomUUID() })), CloudReceiptError)
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM dobius_cloud_receipts').get()!.n, 1)
  })
})
