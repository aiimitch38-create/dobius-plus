import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { openDatabase, type AdamDatabase } from '../src/db/database.js'
import { JobStore } from '../src/jobs/store.js'
import { CloudReceiptError, DobiusCloudReceiptStore } from '../src/dobius-cloud/receipt-store.js'
import type { AdamCloudIntentSealer } from '../src/dobius-cloud/intent-contract.js'
import { canonicalCloudJobAdamJson, canonicalCloudJobAdamSha256 } from '../src/dobius-cloud/receipt-contract.js'

const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup() })

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'adam-approved-payload-'))
  const file = join(base, 'database.sqlite')
  let now = 100_000
  let db: AdamDatabase = openDatabase(file)
  const parentObjectiveId = new JobStore(db).createJob({ objective: 'Synthetic approved intent parent', projectId: 'project' })
  const job = {
    requestKey: 'child-request', taskId: 'task-1', projectId: 'project', workspaceId: 'workspace',
    targetDeviceId: 'hermes-1', recipeId: 'build', title: 'Approved child', sourceRevision: 'a'.repeat(40),
    estimatedBytes: 0, dependencies: []
  }
  const request = {
    intentId: '8f084f3e-e22e-4413-bc7e-b271cb5626b5', parentObjectiveId, parentObjectiveVersion: 1,
    projectId: 'project', contextDigest: 'b'.repeat(64), requestFingerprint: canonicalCloudJobAdamSha256(job),
    ttlMs: 1000, approvedJob: job
  }
  const sealer: AdamCloudIntentSealer = async (envelope) => `sealed-test-v1:${envelope.intentId}`
  const store = () => new DobiusCloudReceiptStore(db, () => now)
  const reopen = () => { db.close(); db = openDatabase(file) }
  cleanups.push(() => { try { db.close() } catch {} rmSync(base, { recursive: true, force: true }) })
  return { base, file, request, parentObjectiveId, sealer, get db() { return db }, get store() { return store() }, reopen,
    setNow: (value: number) => { now = value } }
}

function requestText(f: ReturnType<typeof fixture>, overrides: Record<string, unknown> = {}): string {
  return canonicalCloudJobAdamJson({ ...f.request, ...overrides })
}

const count = (db: AdamDatabase, table: string): number =>
  Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n)

function storedMaterial(f: ReturnType<typeof fixture>): Buffer[] {
  return readdirSync(f.base).filter((name) => name.startsWith('database.sqlite'))
    .map((name) => readFileSync(join(f.base, name)))
}

describe('ADAM approved job payload publication candidate', () => {
  it('atomically stores the exact canonical payload and reopens the same non-secret identity', async () => {
    const f = fixture()
    const raw = requestText(f)
    const issued = await f.store.issueApprovedJobGrantWithIntent(raw, f.sealer)
    assert.equal(issued.status, 'issued')
    if (issued.status !== 'issued') return
    const row = f.db.prepare('SELECT approved_payload_json,approved_payload_digest FROM dobius_cloud_intents').get() as
      { approved_payload_json: string; approved_payload_digest: string }
    assert.equal(row.approved_payload_json, canonicalCloudJobAdamJson(f.request.approvedJob))
    assert.equal(row.approved_payload_digest, f.request.requestFingerprint)
    for (const material of storedMaterial(f)) assert.equal(material.includes(Buffer.from(issued.grant.capability)), false)
    const { capability, ...binding } = issued.grant
    assert.equal(f.store.consume({ schemaVersion: 1, capability, binding }).consumed, true)
    f.reopen()
    f.setNow(500_000)
    const duplicate = await f.store.issueApprovedJobGrantWithIntent(raw,
      async () => assert.fail('duplicate publication must not reseal'))
    assert.deepEqual(duplicate, {
      status: 'existing', intentId: f.request.intentId, bindingId: issued.grant.bindingId,
      expiresAtMs: issued.grant.expiresAtMs
    })
    assert.equal(count(f.db, 'dobius_cloud_bindings'), 1)
    assert.equal(count(f.db, 'dobius_cloud_intents'), 1)
  })

  it('rejects object/proxy, malformed, noncanonical, unknown, mismatched and oversized input before sealing', async () => {
    const f = fixture()
    let seals = 0
    const sealer: AdamCloudIntentSealer = async () => { seals += 1; return 'sealed-test-v1' }
    await assert.rejects(f.store.issueApprovedJobGrantWithIntent({ ...f.request }, sealer), CloudReceiptError)
    let traps = 0
    const proxy = new Proxy({}, { getPrototypeOf() { traps += 1; throw new Error('proxy inspected') } })
    await assert.rejects(f.store.issueApprovedJobGrantWithIntent(proxy, sealer), CloudReceiptError)
    assert.equal(traps, 0)
    await assert.rejects(f.store.issueApprovedJobGrantWithIntent('{"bad":undefined}', sealer), CloudReceiptError)
    const altered = structuredClone(f.request)
    altered.approvedJob.title = 'Altered child'
    await assert.rejects(f.store.issueApprovedJobGrantWithIntent(canonicalCloudJobAdamJson(altered), sealer), CloudReceiptError)
    const unknown = structuredClone(f.request) as typeof f.request & { extra: boolean }
    unknown.extra = true
    await assert.rejects(f.store.issueApprovedJobGrantWithIntent(canonicalCloudJobAdamJson(unknown), sealer), CloudReceiptError)
    const canonical = requestText(f)
    await assert.rejects(f.store.issueApprovedJobGrantWithIntent(` ${canonical}`, sealer), CloudReceiptError)
    await assert.rejects(f.store.issueApprovedJobGrantWithIntent(canonical.replace('{', '{"ttlMs":60000,'), sealer), CloudReceiptError)
    await assert.rejects(f.store.issueApprovedJobGrantWithIntent(' '.repeat(64 * 1024 + 1), sealer), CloudReceiptError)
    assert.equal(seals, 0)
    assert.equal(count(f.db, 'dobius_cloud_bindings'), 0)
    assert.equal(count(f.db, 'dobius_cloud_intents'), 0)
  })

  it('refuses a changed payload under an existing intent without reseal or second job', async () => {
    const f = fixture()
    await f.store.issueApprovedJobGrantWithIntent(requestText(f), f.sealer)
    const changed = structuredClone(f.request)
    changed.approvedJob.title = 'Changed approved child'
    changed.requestFingerprint = canonicalCloudJobAdamSha256(changed.approvedJob)
    await assert.rejects(f.store.issueApprovedJobGrantWithIntent(canonicalCloudJobAdamJson(changed),
      async () => assert.fail('changed duplicate must not reseal')),
    (error: unknown) => error instanceof CloudReceiptError && error.code === 'conflict')
    assert.equal(count(f.db, 'dobius_cloud_bindings'), 1)
    assert.equal(count(f.db, 'dobius_cloud_intents'), 1)
  })

  it('fails closed if a persisted payload or digest is changed', async () => {
    const f = fixture()
    const issued = await f.store.issueApprovedJobGrantWithIntent(requestText(f), f.sealer)
    if (issued.status !== 'issued') return
    f.db.prepare("UPDATE dobius_cloud_intents SET approved_payload_digest=?").run('0'.repeat(64))
    await assert.rejects(f.store.issueApprovedJobGrantWithIntent(requestText(f), f.sealer),
      (error: unknown) => error instanceof CloudReceiptError && error.code === 'conflict')
    const { capability, ...binding } = issued.grant
    assert.throws(() => f.store.consume({ schemaVersion: 1, capability, binding }),
      (error: unknown) => error instanceof CloudReceiptError && error.code === 'conflict')
  })

  it('keeps legacy identity-only intents unavailable without backfilling approval', async () => {
    const f = fixture()
    const { approvedJob: _approvedJob, ...legacyRequest } = f.request
    const legacy = await f.store.issueGrantWithIntent(legacyRequest, f.sealer)
    await assert.rejects(f.store.issueApprovedJobGrantWithIntent(requestText(f),
      async () => assert.fail('legacy row must not reseal')),
    (error: unknown) => error instanceof CloudReceiptError && error.code === 'conflict')
    if (legacy.status === 'issued') {
      const { capability, ...binding } = legacy.grant
      assert.throws(() => f.store.consume({ schemaVersion: 1, capability, binding }),
        (error: unknown) => error instanceof CloudReceiptError && error.code === 'conflict')
    }
    const row = f.db.prepare('SELECT approved_payload_json,approved_payload_digest FROM dobius_cloud_intents').get() as
      { approved_payload_json: string | null; approved_payload_digest: string | null }
    assert.equal(row.approved_payload_json, null)
    assert.equal(row.approved_payload_digest, null)
  })

  it('rolls back payload, intent and binding when the transaction fails', async () => {
    const f = fixture()
    f.db.exec(`CREATE TRIGGER fail_approved_intent BEFORE INSERT ON dobius_cloud_intents
      BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END`)
    await assert.rejects(f.store.issueApprovedJobGrantWithIntent(requestText(f), f.sealer), CloudReceiptError)
    assert.equal(count(f.db, 'dobius_cloud_bindings'), 0)
    assert.equal(count(f.db, 'dobius_cloud_intents'), 0)
  })
})
