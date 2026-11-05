import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { it } from 'node:test'
import { openDatabase } from '../src/db/database.js'
import { MIGRATIONS } from '../src/db/migrations.js'
import { JobStore } from '../src/jobs/store.js'
import { DobiusCloudReceiptStore } from '../src/dobius-cloud/receipt-store.js'
import { canonicalCloudJobAdamSha256 } from '../src/dobius-cloud/receipt-contract.js'

it('upgrades an existing v17 job database and replays receipts after actual close/reopen', () => {
  const base = mkdtempSync(join(tmpdir(), 'adam-receipt-upgrade-'))
  const file = join(base, 'adam.sqlite')
  let db = new DatabaseSync(file)
  try {
    for (const migration of MIGRATIONS) {
      if (migration.version <= 17) db.exec(migration.sql)
    }
    db.exec('PRAGMA user_version=17')
    const oldJobs = new JobStore(db)
    const parent = oldJobs.createJob({ objective: 'Preserved synthetic parent', projectId: 'fixture' })
    const before = oldJobs.getJob(parent)
    db.close()
    db = openDatabase(file)
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 21)
    assert.deepEqual(new JobStore(db).getJob(parent), before)
    const store = new DobiusCloudReceiptStore(db, () => 100_000)
    const { capability, ...binding } = store.issueGrant({ parentObjectiveId: parent,
      parentObjectiveVersion: 1, projectId: 'fixture', contextDigest: 'a'.repeat(64),
      requestFingerprint: 'b'.repeat(64), ttlMs: 1000 })
    const consumed = store.consume({ schemaVersion: 1, capability, binding })
    const receipt = { schemaVersion: 1, receiptId: randomUUID(), bindingId: binding.bindingId,
      adamInstanceId: binding.adamInstanceId, parentObjectiveId: parent, parentObjectiveVersion: 1,
      cloudJobId: randomUUID(), cloudJobVersion: 1, cloudEventSequence: 1, attemptId: null,
      attemptNumber: null, eventKind: 'submitted', cloudJobState: 'queued', projectId: 'fixture',
      contextDigest: binding.contextDigest, evidenceDigests: [], occurredAtMs: 100_000 }
    const packet = { schemaVersion: 1, receipt, payloadSha256: canonicalCloudJobAdamSha256(receipt) }
    const ack = store.receive(packet)
    db.close()
    db = openDatabase(file)
    const recovered = new DobiusCloudReceiptStore(db, () => 200_000)
    assert.equal(recovered.instanceId, store.instanceId)
    assert.deepEqual(recovered.consume({ schemaVersion: 1, capability, binding }), consumed)
    assert.deepEqual(recovered.receive(packet), { ...ack, accepted: 'duplicate' })
    assert.deepEqual(new JobStore(db).getJob(parent), before)
    assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok')
  } finally {
    db.close()
    rmSync(base, { recursive: true, force: true })
  }
})
