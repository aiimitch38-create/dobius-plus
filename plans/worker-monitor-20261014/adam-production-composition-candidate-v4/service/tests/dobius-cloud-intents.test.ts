import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { openDatabase, type AdamDatabase } from '../src/db/database.js'
import { JobStore } from '../src/jobs/store.js'
import { CloudReceiptError, DobiusCloudReceiptStore } from '../src/dobius-cloud/receipt-store.js'
import type { AdamCloudIntentEnvelope, AdamCloudIntentSealer } from '../src/dobius-cloud/intent-contract.js'

const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup() })

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'adam-cloud-intents-'))
  const file = join(base, 'database.sqlite')
  let now = 100_000
  let db: AdamDatabase = openDatabase(file)
  const parent = new JobStore(db).createJob({ objective: 'Synthetic intent parent', projectId: 'project' })
  let store = new DobiusCloudReceiptStore(db, () => now)
  const request = { intentId: '8f084f3e-e22e-4413-bc7e-b271cb5626b5', parentObjectiveId: parent,
    parentObjectiveVersion: 1, projectId: 'project', contextDigest: 'a'.repeat(64),
    requestFingerprint: 'b'.repeat(64), ttlMs: 1000 }
  const seal: AdamCloudIntentSealer = async (envelope) => `sealed-test-v1:${envelope.intentId}`
  const close = () => db.close()
  cleanups.push(() => { try { db.close() } catch {} rmSync(base, { recursive: true, force: true }) })
  return {
    base, file, request, parent, seal,
    get db() { return db },
    get store() { return store },
    setNow: (value: number) => { now = value },
    reopen: () => { close(); db = openDatabase(file); store = new DobiusCloudReceiptStore(db, () => now) }
  }
}

const count = (db: AdamDatabase, table: string): number =>
  Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n)

function storedMaterial(f: ReturnType<typeof fixture>): Buffer[] {
  return readdirSync(f.base).filter((name) => name.startsWith('database.sqlite'))
    .map((name) => readFileSync(join(f.base, name)))
}

describe('ADAM durable intent publication candidate', () => {
  it('seals before acquiring the writer and publishes both rows only after resolution', async () => {
    const f = fixture()
    let finish: ((value: unknown) => void) | undefined
    let observed: AdamCloudIntentEnvelope | undefined
    const paused = f.store.issueGrantWithIntent(f.request, (envelope) => {
      observed = envelope
      return new Promise((resolve) => { finish = resolve })
    })
    assert.equal(observed?.identity.expiresAtMs, 101_000)
    assert.equal(count(f.db, 'dobius_cloud_bindings'), 0)
    assert.equal(count(f.db, 'dobius_cloud_intents'), 0)
    assert.ok(finish)
    finish('sealed-test-v1:paused')
    const result = await paused
    assert.equal(result.status, 'issued')
    assert.equal(count(f.db, 'dobius_cloud_bindings'), 1)
    assert.equal(count(f.db, 'dobius_cloud_intents'), 1)
  })

  it('refuses a missing, throwing, malformed, or plaintext sealer result without publication', async () => {
    const f = fixture()
    const missing = Reflect.apply(f.store.issueGrantWithIntent, f.store, [f.request])
    await assert.rejects(missing, CloudReceiptError)
    await assert.rejects(f.store.issueGrantWithIntent(f.request, async () => { throw new Error('secret must not escape') }), CloudReceiptError)
    await assert.rejects(f.store.issueGrantWithIntent(f.request, async () => ({ bad: true })), CloudReceiptError)
    await assert.rejects(f.store.issueGrantWithIntent(f.request, async (envelope) => envelope.capability), CloudReceiptError)
    assert.equal(count(f.db, 'dobius_cloud_bindings'), 0)
    assert.equal(count(f.db, 'dobius_cloud_intents'), 0)
  })

  it('rolls back the binding when the intent insert fails', async () => {
    const f = fixture()
    f.db.exec(`CREATE TRIGGER fail_intent BEFORE INSERT ON dobius_cloud_intents
      BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END`)
    await assert.rejects(f.store.issueGrantWithIntent(f.request, f.seal), CloudReceiptError)
    assert.equal(count(f.db, 'dobius_cloud_bindings'), 0)
    assert.equal(count(f.db, 'dobius_cloud_intents'), 0)
  })

  it('refuses expiry and changed parent revision during the asynchronous seal', async () => {
    const expired = fixture()
    let releaseExpiry: (() => void) | undefined
    const pendingExpiry = expired.store.issueGrantWithIntent(expired.request, async () =>
      new Promise((resolve) => { releaseExpiry = () => resolve('sealed-expiry') }))
    expired.setNow(101_000)
    releaseExpiry?.()
    await assert.rejects(pendingExpiry, (error: unknown) => error instanceof CloudReceiptError && error.code === 'expired')
    assert.equal(count(expired.db, 'dobius_cloud_bindings'), 0)

    const changed = fixture()
    let releaseParent: (() => void) | undefined
    const pendingParent = changed.store.issueGrantWithIntent(changed.request, async () =>
      new Promise((resolve) => { releaseParent = () => resolve('sealed-parent') }))
    changed.db.prepare("UPDATE jobs SET objective='Changed synthetic parent' WHERE id=?").run(changed.parent)
    releaseParent?.()
    await assert.rejects(pendingParent, (error: unknown) => error instanceof CloudReceiptError && error.code === 'conflict')
    assert.equal(count(changed.db, 'dobius_cloud_bindings'), 0)
  })

  it('rejects unsafe and backward store-clock values without publication', async () => {
    const unsafe = fixture()
    unsafe.setNow(Number.NaN)
    await assert.rejects(unsafe.store.issueGrantWithIntent(unsafe.request, unsafe.seal),
      (error: unknown) => error instanceof CloudReceiptError && error.code === 'invalid')
    assert.equal(count(unsafe.db, 'dobius_cloud_bindings'), 0)

    const backward = fixture()
    let release: (() => void) | undefined
    const pending = backward.store.issueGrantWithIntent(backward.request, async () =>
      new Promise((resolve) => { release = () => resolve('sealed-backward') }))
    backward.setNow(99_999)
    release?.()
    await assert.rejects(pending, (error: unknown) => error instanceof CloudReceiptError && error.code === 'invalid')
    assert.equal(count(backward.db, 'dobius_cloud_bindings'), 0)
    assert.equal(count(backward.db, 'dobius_cloud_intents'), 0)
  })

  it('returns an exact non-secret duplicate after reopen without extending expiry', async () => {
    const f = fixture()
    const first = await f.store.issueGrantWithIntent(f.request, f.seal)
    assert.equal(first.status, 'issued')
    if (first.status !== 'issued') return
    const capability = first.grant.capability
    f.reopen()
    f.setNow(500_000)
    const repeated = await f.store.issueGrantWithIntent(f.request, async () => assert.fail('duplicate must not reseal'))
    assert.equal(repeated.status, 'existing')
    assert.equal(JSON.stringify(repeated).includes(capability), false)
    assert.equal(count(f.db, 'dobius_cloud_bindings'), 1)
    assert.equal(count(f.db, 'dobius_cloud_intents'), 1)
    assert.equal(Number(f.db.prepare('SELECT expires_at_ms FROM dobius_cloud_intents').get()?.expires_at_ms), 101_000)
  })

  it('refuses a duplicate after reopened store metadata changes', async () => {
    const f = fixture()
    await f.store.issueGrantWithIntent(f.request, f.seal)
    f.reopen()
    f.db.prepare("UPDATE dobius_cloud_metadata SET value='changed-instance' WHERE key='instance_id'").run()
    await assert.rejects(f.store.issueGrantWithIntent(f.request, f.seal),
      (error: unknown) => error instanceof CloudReceiptError && error.code === 'conflict')
    assert.equal(count(f.db, 'dobius_cloud_bindings'), 1)
    assert.equal(count(f.db, 'dobius_cloud_intents'), 1)
  })

  it('refuses a copied and rebound database through a new store instance', async () => {
    const f = fixture()
    await f.store.issueGrantWithIntent(f.request, f.seal)
    f.reopen()
    const copiedFile = join(f.base, 'copied.sqlite')
    f.db.close()
    copyFileSync(f.file, copiedFile)
    const copiedDb = openDatabase(copiedFile)
    try {
      copiedDb.prepare("UPDATE dobius_cloud_metadata SET value='rebound-instance' WHERE key='instance_id'").run()
      const copiedStore = new DobiusCloudReceiptStore(copiedDb, () => 500_000)
      await assert.rejects(copiedStore.issueGrantWithIntent(f.request, f.seal),
        (error: unknown) => error instanceof CloudReceiptError && error.code === 'conflict')
      assert.equal(count(copiedDb, 'dobius_cloud_bindings'), 1)
      assert.equal(count(copiedDb, 'dobius_cloud_intents'), 1)
    } finally { copiedDb.close() }
  })

  it('rechecks instance metadata for a duplicate that races while sealing', async () => {
    const f = fixture()
    const resolvers: ((value: unknown) => void)[] = []
    const sealer: AdamCloudIntentSealer = async () => new Promise((resolve) => { resolvers.push(resolve) })
    const first = f.store.issueGrantWithIntent(f.request, sealer)
    const second = f.store.issueGrantWithIntent(f.request, sealer)
    resolvers[0]?.('sealed-first')
    const issued = await first
    assert.equal(issued.status, 'issued')
    f.db.prepare("UPDATE dobius_cloud_metadata SET value='changed-during-seal' WHERE key='instance_id'").run()
    resolvers[1]?.('sealed-second')
    await assert.rejects(second, (error: unknown) => error instanceof CloudReceiptError && error.code === 'conflict')
    assert.equal(count(f.db, 'dobius_cloud_bindings'), 1)
    assert.equal(count(f.db, 'dobius_cloud_intents'), 1)
  })

  it('refuses mismatched or malformed persisted binding identity and digest', async () => {
    const f = fixture()
    await f.store.issueGrantWithIntent(f.request, f.seal)
    const identity = f.db.prepare('SELECT identity_json,identity_digest FROM dobius_cloud_bindings').get() as
      { identity_json: string; identity_digest: string }
    const refuse = () => f.store.issueGrantWithIntent(f.request, f.seal)
    f.db.prepare("UPDATE dobius_cloud_bindings SET identity_digest='0' WHERE binding_id=(SELECT binding_id FROM dobius_cloud_intents)").run()
    await assert.rejects(refuse(), (error: unknown) => error instanceof CloudReceiptError && error.code === 'conflict')
    f.db.prepare('UPDATE dobius_cloud_bindings SET identity_digest=?').run(identity.identity_digest)
    f.db.prepare("UPDATE dobius_cloud_bindings SET identity_json='{}'").run()
    await assert.rejects(refuse(), (error: unknown) => error instanceof CloudReceiptError && error.code === 'conflict')
    assert.equal(count(f.db, 'dobius_cloud_bindings'), 1)
    assert.equal(count(f.db, 'dobius_cloud_intents'), 1)
  })

  it('rejects a conflicting identity under an already-used stable key', async () => {
    const f = fixture()
    await f.store.issueGrantWithIntent(f.request, f.seal)
    await assert.rejects(f.store.issueGrantWithIntent({ ...f.request, contextDigest: 'c'.repeat(64) }, f.seal),
      (error: unknown) => error instanceof CloudReceiptError && error.code === 'conflict')
    assert.equal(count(f.db, 'dobius_cloud_bindings'), 1)
    assert.equal(count(f.db, 'dobius_cloud_intents'), 1)
  })

  it('allows only one publication when concurrent sealers race on the same stable key', async () => {
    const f = fixture()
    const resolvers: ((value: unknown) => void)[] = []
    const sealer: AdamCloudIntentSealer = async () => new Promise((resolve) => { resolvers.push(resolve) })
    const left = f.store.issueGrantWithIntent(f.request, sealer)
    const right = f.store.issueGrantWithIntent(f.request, sealer)
    assert.equal(resolvers.length, 2)
    resolvers[0]?.('sealed-race-left')
    resolvers[1]?.('sealed-race-right')
    const results = await Promise.all([left, right])
    assert.deepEqual(results.map((result) => result.status).sort(), ['existing', 'issued'])
    assert.equal(count(f.db, 'dobius_cloud_bindings'), 1)
    assert.equal(count(f.db, 'dobius_cloud_intents'), 1)
  })

  it('persists only a hash and sealed envelope, never the capability in DB, WAL, or errors', async () => {
    const f = fixture()
    const result = await f.store.issueGrantWithIntent(f.request, f.seal)
    assert.equal(result.status, 'issued')
    if (result.status !== 'issued') return
    const rawCapability = Buffer.from(result.grant.capability)
    assert.ok(storedMaterial(f).length >= 1)
    for (const material of storedMaterial(f)) assert.equal(material.includes(rawCapability), false)
    const rows = f.db.prepare('SELECT * FROM dobius_cloud_intents').all()
    assert.equal(JSON.stringify(rows).includes(result.grant.capability), false)
    assert.equal(JSON.stringify(rows).includes('sealed-test-v1:'), true)
    let generatedCapability = ''
    let sanitizedError: unknown
    try {
      await f.store.issueGrantWithIntent({ ...f.request, intentId: 'e2358c57-85ce-49f5-a899-607c8727a4ad' }, async (envelope) => {
        generatedCapability = envelope.capability
        throw new Error(generatedCapability)
      })
    } catch (error) { sanitizedError = error }
    assert.ok(sanitizedError instanceof CloudReceiptError)
    assert.equal(String(sanitizedError).includes(generatedCapability), false)
    for (const material of storedMaterial(f)) assert.equal(material.includes(Buffer.from(generatedCapability)), false)
    assert.equal(count(f.db, 'dobius_cloud_bindings'), 1)
    assert.equal(count(f.db, 'dobius_cloud_intents'), 1)
  })
})
