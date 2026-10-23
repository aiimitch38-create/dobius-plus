import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { openDatabase, type AdamDatabase } from '../src/db/database.js'
import { JobStore } from '../src/jobs/store.js'
import { DobiusCloudReceiptStore } from '../src/dobius-cloud/receipt-store.js'
import {
  createApprovedDecisionPublisher
} from '../src/dobius-cloud/approved-decision-publisher.js'
import type { IntentBridgeCall, IntentBridgeCredential } from '../src/dobius-cloud/intent-bridge-cli.js'
import { canonicalCloudJobAdamJson } from '../src/dobius-cloud/receipt-contract.js'

const cleanup: (() => void)[] = []
afterEach(() => { for (const action of cleanup.splice(0)) action() })

const runtimeId = '6f97e464-420a-4c7c-8d40-ff69ab0e6b9b'
const decisionId = '8f084f3e-e22e-4413-bc7e-b271cb5626b5'
const childId = 'job-child-001'
const serviceCredential = Buffer.alloc(32, 0x44).toString('base64url')
const payload = {
  requestKey: 'approval-001', taskId: 'task-001', projectId: 'project-a', workspaceId: 'workspace-a',
  targetDeviceId: 'device-a', recipeId: 'recipe-a', title: 'Approved synthetic job',
  sourceRevision: 'a'.repeat(40), estimatedBytes: 1024, dependencies: [] as string[]
}

function fixture(options: {
  enabled?: boolean; failFirstSubmit?: boolean; revokeAfterSeal?: boolean; revokeAtDecisionCheck?: number;
  revokeOnSubmit?: boolean; wrongChild?: boolean
} = {}) {
  let now = 100_000
  let current = true
  let decisionChecks = 0
  const base = mkdtempSync(join(tmpdir(), 'adam-approved-decision-'))
  const dbPath = join(base, 'adam.sqlite')
  let db: AdamDatabase = openDatabase(dbPath)
  const parentId = new JobStore(db).createJob({ objective: 'Synthetic parent', projectId: payload.projectId })
  let receipts = new DobiusCloudReceiptStore(db, () => now)
  const decision = {
    schemaVersion: 1, decisionId, actorId: 'actor-test', actorSourceId: 'imessage-test',
    sourceEventId: 'event-test-1', actorEvidenceDigest: 'b'.repeat(64), sourceBinding: 'c'.repeat(64),
    authorityGeneration: 1, parentObjectiveId: parentId, parentObjectiveVersion: 1, projectId: payload.projectId,
    contextDigest: 'd'.repeat(64), expiresAtMs: 200_000, approvedPayloadJson: canonicalCloudJobAdamJson(payload)
  }
  const decisionAuthority = {
    resolveExactDecisionJson: async (id: string) => id === decisionId ? canonicalCloudJobAdamJson(decision) : null,
    isCurrent: () => {
      decisionChecks += 1
      if (options.revokeAtDecisionCheck === decisionChecks) current = false
      return current
    }
  }
  const credential: IntentBridgeCredential = {
    schemaVersion: 1, audienceRuntimeId: runtimeId, credential: serviceCredential,
    runtimeUserDataPath: '/synthetic/runtime', authorizationGeneration: 1
  }
  const credentialAuthority = { acquire: async () => credential, isCurrent: () => true }
  let seals = 0
  let submits = 0
  let revokedSubmit = false
  const seenSubmit: Record<string, unknown>[] = []
  const invoke: IntentBridgeCall = async (_executable, args, body) => {
    const request = JSON.parse(body) as Record<string, unknown>
    if (args[0] === 'seal-adam-intent') {
      seals += 1
      const envelope = request.envelope as { intentId: string; identity: unknown }
      const response = { ok: true, _meta: { runtimeId }, result: {
        schemaVersion: 1, audienceRuntimeId: runtimeId, intentId: envelope.intentId,
        identity: envelope.identity, sealedEnvelope: `sealed:${envelope.intentId}`
      } }
      if (options.revokeAfterSeal) current = false
      return response
    }
    assert.deepEqual(args, ['submit-adam-child', '--request-stdin', '--json'])
    assert.equal(JSON.stringify(args).includes(serviceCredential), false)
    assert.equal('grant' in request || 'capability' in request, false)
    seenSubmit.push(request)
    submits += 1
    if (options.failFirstSubmit && submits === 1) throw new Error('synthetic lost acknowledgement')
    if (options.revokeOnSubmit && !revokedSubmit) { current = false; revokedSubmit = true }
    const submitRequest = request as {
      intentId: string; identity: unknown; approvedJob: typeof payload
    }
    return { ok: true, _meta: { runtimeId }, result: {
      schemaVersion: 1, audienceRuntimeId: runtimeId, intentId: submitRequest.intentId,
      identity: submitRequest.identity,
      job: { ...submitRequest.approvedJob, ...(options.wrongChild ? { projectId: 'other-project' } : {}), id: childId, state: 'queued' }
    } }
  }
  const make = (enabled = options.enabled ?? true) => createApprovedDecisionPublisher({
    enabled, database: db, receipts, decisionAuthority, credentialAuthority,
    dobiusExecutablePath: '/synthetic/dobius', invoke, now: () => now
  })
  cleanup.push(() => { try { db.close() } catch {} rmSync(base, { recursive: true, force: true }) })
  return {
    get db() { return db }, get receipts() { return receipts }, decision, decisionAuthority, make,
    counts: () => ({ decisions: Number(db.prepare('SELECT count(*) n FROM dobius_cloud_approved_decisions').get()?.n),
      bindings: Number(db.prepare('SELECT count(*) n FROM dobius_cloud_bindings').get()?.n),
      intents: Number(db.prepare('SELECT count(*) n FROM dobius_cloud_intents').get()?.n) }),
    parentState: () => db.prepare('SELECT state FROM jobs WHERE id=?').get(parentId)?.state,
    setCurrent: (value: boolean) => { current = value }, setNow: (value: number) => { now = value },
    metrics: () => ({ seals, submits, seenSubmit, decisionChecks }),
    reopen: () => { db.close(); db = openDatabase(dbPath); receipts = new DobiusCloudReceiptStore(db, () => now) }
  }
}

describe('ADAM approved-decision production composition candidate', () => {
  it('is unavailable by default and rejects request objects before consulting authority', async () => {
    const f = fixture({ enabled: false })
    assert.equal(f.make(), undefined)
    const enabled = f.make(true)!
    await assert.rejects(enabled.dispatch({ decisionId, senderId: 'carson', approvedJob: payload }))
    assert.deepEqual(f.counts(), { decisions: 0, bindings: 0, intents: 0 })
  })

  it('refuses absent trusted exact decision without binding, intent or sealer side effects', async () => {
    const f = fixture()
    f.decisionAuthority.resolveExactDecisionJson = async () => null
    await assert.rejects(f.make()!.dispatch(decisionId))
    assert.deepEqual(f.counts(), { decisions: 0, bindings: 0, intents: 0 })
    assert.equal(f.metrics().seals, 0)
  })

  it('publishes exact approved payload then submits only the durable sealed DTO without changing parent', async () => {
    const f = fixture()
    const result = await f.make()!.dispatch(decisionId)
    assert.equal(result.child.id, childId)
    assert.deepEqual(f.counts(), { decisions: 1, bindings: 1, intents: 1 })
    assert.equal(f.metrics().seals, 1)
    assert.equal(f.metrics().submits, 1)
    assert.equal(f.parentState(), 'received')
    assert.equal(f.metrics().seenSubmit[0]?.credential, serviceCredential)
    assert.equal(JSON.stringify(f.metrics().seenSubmit[0]).includes('capability'), false)
  })

  it('retries lost child acknowledgement after reopen with the same intent and no reseal or expiry renewal', async () => {
    const f = fixture({ failFirstSubmit: true })
    const publisher = f.make()!
    await assert.rejects(publisher.dispatch(decisionId))
    const intentBefore = f.db.prepare('SELECT intent_id,expires_at_ms FROM dobius_cloud_intents').get() as
      { intent_id: string; expires_at_ms: number }
    assert.equal(f.metrics().seals, 1)
    const priorRequest = f.metrics().seenSubmit[0]
    f.reopen()
    await f.make()!.recover()
    const intentAfter = f.db.prepare('SELECT intent_id,expires_at_ms FROM dobius_cloud_intents').get() as
      { intent_id: string; expires_at_ms: number }
    assert.deepEqual(intentAfter, intentBefore)
    assert.equal(f.metrics().seals, 1)
    assert.equal(f.metrics().seenSubmit[1]?.intentId, priorRequest?.intentId)
    assert.equal(f.metrics().seenSubmit[1]?.identity &&
      canonicalCloudJobAdamJson(f.metrics().seenSubmit[1]?.identity), canonicalCloudJobAdamJson(priorRequest?.identity))
    assert.deepEqual(f.counts(), { decisions: 1, bindings: 1, intents: 1 })
  })

  it('reuses a sealed staged intent after publication transaction rollback without resealing', async () => {
    const f = fixture()
    const publisher = f.make()!
    f.db.exec(`CREATE TRIGGER reject_intent BEFORE INSERT ON dobius_cloud_intents
      BEGIN SELECT RAISE(ABORT, 'synthetic rollback'); END`)
    await assert.rejects(publisher.dispatch(decisionId))
    assert.deepEqual(f.counts(), { decisions: 1, bindings: 0, intents: 0 })
    assert.equal(f.metrics().seals, 1)
    const staged = f.db.prepare(`SELECT staged_identity_json,staged_sealed_envelope,staged_capability_hash
      FROM dobius_cloud_approved_decisions WHERE decision_id=?`).get(decisionId) as Record<string, unknown>
    assert.equal(typeof staged.staged_identity_json, 'string')
    assert.equal(typeof staged.staged_sealed_envelope, 'string')
    assert.equal(typeof staged.staged_capability_hash, 'string')
    f.db.exec('DROP TRIGGER reject_intent')
    f.setNow(131_000)
    await publisher.recover()
    assert.deepEqual(f.counts(), { decisions: 1, bindings: 1, intents: 1 })
    assert.equal(f.metrics().seals, 1)
    assert.equal(f.metrics().submits, 1)
    assert.equal(Number(f.db.prepare('SELECT expires_at_ms FROM dobius_cloud_intents').get()?.expires_at_ms), 200_000)
  })

  it('fences revocation after the awaited seal before publishing a binding', async () => {
    const f = fixture({ revokeAfterSeal: true })
    await assert.rejects(f.make()!.dispatch(decisionId))
    assert.deepEqual(f.counts(), { decisions: 1, bindings: 0, intents: 0 })
    assert.equal(f.metrics().submits, 0)
  })

  it('rechecks decision authority synchronously at the binding publication boundary', async () => {
    const f = fixture({ revokeAtDecisionCheck: 6 })
    await assert.rejects(f.make()!.dispatch(decisionId))
    assert.equal(f.metrics().decisionChecks, 6)
    assert.deepEqual(f.counts(), { decisions: 1, bindings: 0, intents: 0 })
  })

  it('keeps the published intent retryable when authority revokes during child submission', async () => {
    const f = fixture({ revokeOnSubmit: true })
    const publisher = f.make()!
    await assert.rejects(publisher.dispatch(decisionId))
    assert.deepEqual(f.counts(), { decisions: 1, bindings: 1, intents: 1 })
    assert.equal(f.db.prepare('SELECT child_json FROM dobius_cloud_approved_decisions').get()?.child_json, null)
    f.setCurrent(true)
    await publisher.recover()
    assert.equal(f.metrics().seals, 1)
    assert.equal(f.metrics().submits, 2)
    assert.equal(f.db.prepare("SELECT json_extract(child_json, '$.id') AS id FROM dobius_cloud_approved_decisions")
      .get()?.id, childId)
  })

  it('rejects a mismatched wire runtime response without durable publication', async () => {
    const f = fixture()
    const base = f.make()!
    const badInvoke: IntentBridgeCall = async (_path, args, body) => {
      const request = JSON.parse(body) as Record<string, unknown>
      if (args[0] !== 'seal-adam-intent') return assert.fail('must refuse before submit')
      const envelope = request.envelope as { intentId: string; identity: unknown }
      return { ok: true, _meta: { runtimeId: '00000000-0000-4000-8000-000000000001' }, result: {
        schemaVersion: 1, audienceRuntimeId: runtimeId, intentId: envelope.intentId,
        identity: envelope.identity, sealedEnvelope: 'sealed'
      } }
    }
    const publisher = createApprovedDecisionPublisher({ enabled: true, database: f.db, receipts: f.receipts,
      decisionAuthority: f.decisionAuthority, credentialAuthority: { acquire: async () => ({
        schemaVersion: 1, audienceRuntimeId: runtimeId, credential: serviceCredential,
        runtimeUserDataPath: '/synthetic/runtime', authorizationGeneration: 1
      }), isCurrent: () => true }, dobiusExecutablePath: '/synthetic/dobius', invoke: badInvoke, now: () => 100_000 })
    assert.ok(base && publisher)
    await assert.rejects(publisher.dispatch(decisionId))
    assert.deepEqual(f.counts(), { decisions: 1, bindings: 0, intents: 0 })
  })

  it('refuses and does not acknowledge a child response for another project', async () => {
    const f = fixture({ wrongChild: true })
    await assert.rejects(f.make()!.dispatch(decisionId))
    assert.deepEqual(f.counts(), { decisions: 1, bindings: 1, intents: 1 })
    assert.equal(f.db.prepare('SELECT child_json FROM dobius_cloud_approved_decisions').get()?.child_json, null)
  })

  it('coalesces overlapping dispatch calls and rejects stale authority before a subsequent effect', async () => {
    const f = fixture()
    const publisher = f.make()!
    const [left, right] = await Promise.all([publisher.dispatch(decisionId), publisher.dispatch(decisionId)])
    assert.equal(left.child.id, right.child.id)
    assert.equal(f.metrics().seals, 1)
    assert.equal(f.metrics().submits, 1)
    f.setNow(300_000)
    assert.equal((await publisher.dispatch(decisionId)).child.id, childId)
    assert.equal(f.metrics().seals, 1)
    f.setCurrent(false)
    await assert.rejects(publisher.dispatch(decisionId))
    assert.deepEqual(f.counts(), { decisions: 1, bindings: 1, intents: 1 })
  })

  it('uses the durable lease CAS across two publisher instances', async () => {
    const f = fixture()
    const first = f.make()!
    const second = f.make()!
    const results = await Promise.allSettled([first.dispatch(decisionId), second.dispatch(decisionId)])
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
    assert.equal(f.metrics().seals, 1)
    assert.equal(f.metrics().submits, 1)
    assert.deepEqual(f.counts(), { decisions: 1, bindings: 1, intents: 1 })
  })
})
