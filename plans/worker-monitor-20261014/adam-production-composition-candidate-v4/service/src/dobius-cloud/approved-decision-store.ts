import { createHash, randomUUID } from 'node:crypto'
import type { AdamDatabase } from '../db/database.js'
import { canonicalCloudJobAdamJson } from './receipt-contract.js'
import { ApprovedJobIntentRequest, parseCanonicalApprovedJobPayload } from './approved-job-payload.js'
import { actorSourceEvidence, type TrustedApprovedCloudDecision } from './approved-decision-contract.js'
import { AdamCloudIntentEnvelope, AdamCloudSealedEnvelope } from './intent-contract.js'
import { CloudJobAdamBindingIdentity } from './receipt-contract.js'

const MAX_INTENT_TTL_MS = 300_000
const DISPATCH_LEASE_MS = 30_000

export class ApprovedDecisionStoreError extends Error {
  constructor(readonly code: 'invalid' | 'expired' | 'conflict' | 'busy' | 'missing') { super(code) }
}

export type ApprovedDecisionRow = {
  decision_id: string
  source_record_json: string
  actor_source_json: string
  authority_generation: number
  source_binding: string
  parent_objective_id: string
  parent_objective_version: number
  project_id: string
  context_digest: string
  approved_payload_json: string
  approved_payload_digest: string
  intent_id: string
  intent_request_json: string
  decision_expires_at_ms: number
  intent_expires_at_ms: number
  staged_identity_json: string | null
  staged_sealed_envelope: string | null
  staged_capability_hash: string | null
  intent_published: number
  lease_token: string | null
  lease_until_ms: number | null
  child_json: string | null
  created_at_ms: number
  updated_at_ms: number
}

export class ApprovedDecisionStore {
  constructor(private readonly db: AdamDatabase) {}

  persistAuthorizedDecision(decision: TrustedApprovedCloudDecision, now: number): ApprovedDecisionRow {
    assertTime(now)
    const payload = parseCanonicalApprovedJobPayload(decision.approvedPayloadJson)
    if (payload.projectId !== decision.projectId) throw new ApprovedDecisionStoreError('conflict')
    const sourceRecordJson = canonicalCloudJobAdamJson(decision)
    const existing = this.get(decision.decisionId)
    if (existing) {
      if (existing.source_record_json !== sourceRecordJson ||
          existing.approved_payload_json !== payload.json || existing.approved_payload_digest !== payload.digest ||
          existing.project_id !== decision.projectId || existing.source_binding !== decision.sourceBinding ||
          existing.authority_generation !== decision.authorityGeneration) {
        throw new ApprovedDecisionStoreError('conflict')
      }
      return existing
    }
    if (decision.expiresAtMs - now < 1000) throw new ApprovedDecisionStoreError('expired')
    const ttlMs = Math.min(MAX_INTENT_TTL_MS, decision.expiresAtMs - now)
    if (ttlMs < 1000) throw new ApprovedDecisionStoreError('expired')
    const intentExpiresAtMs = now + ttlMs
    if (!Number.isSafeInteger(intentExpiresAtMs)) throw new ApprovedDecisionStoreError('invalid')
    const intentId = randomUUID()
    const request = ApprovedJobIntentRequest.parse({
      intentId,
      parentObjectiveId: decision.parentObjectiveId,
      parentObjectiveVersion: decision.parentObjectiveVersion,
      projectId: decision.projectId,
      contextDigest: decision.contextDigest,
      requestFingerprint: payload.digest,
      ttlMs,
      approvedJob: payload.approvedJob
    })
    return this.transaction(() => {
      const raced = this.get(decision.decisionId)
      if (raced) {
        if (raced.source_record_json !== sourceRecordJson || raced.approved_payload_digest !== payload.digest) {
          throw new ApprovedDecisionStoreError('conflict')
        }
        return raced
      }
      const parent = this.db.prepare(`SELECT j.project_id,j.state,r.revision
        FROM jobs j JOIN dobius_parent_revisions r ON r.job_id=j.id WHERE j.id=?`)
        .get(decision.parentObjectiveId) as { project_id: string | null; state: string; revision: number } | undefined
      if (!parent || parent.project_id !== decision.projectId || parent.revision !== decision.parentObjectiveVersion ||
          ['completed', 'reported', 'failed', 'cancelled'].includes(parent.state)) {
        throw new ApprovedDecisionStoreError('conflict')
      }
      this.db.prepare(`INSERT INTO dobius_cloud_approved_decisions
        (decision_id,source_record_json,actor_source_json,authority_generation,source_binding,
         parent_objective_id,parent_objective_version,project_id,context_digest,approved_payload_json,
         approved_payload_digest,intent_id,intent_request_json,decision_expires_at_ms,intent_expires_at_ms,intent_published,
         created_at_ms,updated_at_ms)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`).run(
        decision.decisionId, sourceRecordJson, actorSourceEvidence(decision), decision.authorityGeneration,
        decision.sourceBinding, decision.parentObjectiveId, decision.parentObjectiveVersion, decision.projectId,
        decision.contextDigest, payload.json, payload.digest, intentId, canonicalCloudJobAdamJson(request),
        decision.expiresAtMs, intentExpiresAtMs, now, now
      )
      const inserted = this.get(decision.decisionId)
      if (!inserted) throw new ApprovedDecisionStoreError('conflict')
      return inserted
    })
  }

  get(decisionId: string): ApprovedDecisionRow | undefined {
    return this.db.prepare('SELECT * FROM dobius_cloud_approved_decisions WHERE decision_id=?').get(decisionId) as
      ApprovedDecisionRow | undefined
  }

  listRecoverable(now: number, limit = 1): ApprovedDecisionRow[] {
    assertTime(now)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128) throw new ApprovedDecisionStoreError('invalid')
    return this.db.prepare(`SELECT * FROM dobius_cloud_approved_decisions
      WHERE child_json IS NULL AND (intent_published=1 OR decision_expires_at_ms>?)
        AND (lease_until_ms IS NULL OR lease_until_ms<=?) ORDER BY created_at_ms,decision_id LIMIT ?`)
      .all(now, now, limit) as unknown as ApprovedDecisionRow[]
  }

  claim(decisionId: string, now: number): { token: string; row: ApprovedDecisionRow } {
    assertTime(now)
    return this.transaction(() => {
      const row = this.get(decisionId)
      if (!row) throw new ApprovedDecisionStoreError('missing')
      if (row.child_json !== null) throw new ApprovedDecisionStoreError('conflict')
      if (!row.intent_published && row.decision_expires_at_ms <= now) throw new ApprovedDecisionStoreError('expired')
      if (row.lease_until_ms !== null && row.lease_until_ms > now) throw new ApprovedDecisionStoreError('busy')
      const token = randomUUID()
      const until = now + DISPATCH_LEASE_MS
      if (!Number.isSafeInteger(until)) throw new ApprovedDecisionStoreError('invalid')
      const changed = this.db.prepare(`UPDATE dobius_cloud_approved_decisions SET lease_token=?,lease_until_ms=?,updated_at_ms=?
        WHERE decision_id=? AND child_json IS NULL AND (lease_until_ms IS NULL OR lease_until_ms<=?)`)
        .run(token, until, now, decisionId, now)
      if (Number(changed.changes) !== 1) throw new ApprovedDecisionStoreError('busy')
      return { token, row: { ...row, lease_token: token, lease_until_ms: until } }
    })
  }

  prepareIntentRequest(decisionId: string, token: string, now: number): string {
    assertTime(now)
    return this.transaction(() => {
      const row = this.get(decisionId)
      if (!row || row.lease_token !== token || row.intent_published || row.child_json !== null) {
        throw new ApprovedDecisionStoreError('conflict')
      }
      const ttlMs = row.intent_expires_at_ms - now
      if (!Number.isSafeInteger(ttlMs) || ttlMs < 1000) throw new ApprovedDecisionStoreError('expired')
      let prior: unknown
      try { prior = JSON.parse(row.intent_request_json) } catch { throw new ApprovedDecisionStoreError('conflict') }
      const request = ApprovedJobIntentRequest.safeParse({ ...prior as object, ttlMs })
      if (!request.success || request.data.intentId !== row.intent_id ||
          request.data.projectId !== row.project_id || request.data.requestFingerprint !== row.approved_payload_digest) {
        throw new ApprovedDecisionStoreError('conflict')
      }
      const json = canonicalCloudJobAdamJson(request.data)
      const result = this.db.prepare(`UPDATE dobius_cloud_approved_decisions SET intent_request_json=?,updated_at_ms=?
        WHERE decision_id=? AND lease_token=? AND intent_published=0 AND child_json IS NULL`)
        .run(json, now, decisionId, token)
      if (Number(result.changes) !== 1) throw new ApprovedDecisionStoreError('conflict')
      return json
    })
  }

  stageSealedIntent(decisionId: string, token: string, rawEnvelope: unknown, rawSealed: unknown, now: number): void {
    assertTime(now)
    let envelope: ReturnType<typeof AdamCloudIntentEnvelope.parse>
    let sealedEnvelope: string
    try {
      envelope = AdamCloudIntentEnvelope.parse(rawEnvelope)
      sealedEnvelope = AdamCloudSealedEnvelope.parse(rawSealed)
      if (sealedEnvelope.includes(envelope.capability)) throw new Error('plaintext')
    } catch { throw new ApprovedDecisionStoreError('invalid') }
    const row = this.get(decisionId)
    if (!row || row.lease_token !== token || row.intent_published || row.child_json !== null ||
        row.intent_id !== envelope.intentId) throw new ApprovedDecisionStoreError('conflict')
    const identity = CloudJobAdamBindingIdentity.parse(envelope.identity)
    const request = ApprovedJobIntentRequest.safeParse(JSON.parse(row.intent_request_json))
    if (!request.success || identity.projectId !== row.project_id ||
        identity.parentObjectiveId !== row.parent_objective_id ||
        identity.parentObjectiveVersion !== row.parent_objective_version || identity.contextDigest !== row.context_digest ||
        identity.requestFingerprint !== row.approved_payload_digest || identity.expiresAtMs !== row.intent_expires_at_ms ||
        request.data.intentId !== row.intent_id || request.data.requestFingerprint !== row.approved_payload_digest) {
      throw new ApprovedDecisionStoreError('conflict')
    }
    const identityJson = canonicalCloudJobAdamJson(identity)
    const capabilityHash = createHash('sha256').update(envelope.capability).digest('hex')
    if (row.staged_identity_json !== null || row.staged_sealed_envelope !== null || row.staged_capability_hash !== null) {
      if (row.staged_identity_json !== identityJson || row.staged_sealed_envelope !== sealedEnvelope ||
          row.staged_capability_hash !== capabilityHash) throw new ApprovedDecisionStoreError('conflict')
      return
    }
    const result = this.db.prepare(`UPDATE dobius_cloud_approved_decisions
      SET staged_identity_json=?,staged_sealed_envelope=?,staged_capability_hash=?,updated_at_ms=?
      WHERE decision_id=? AND lease_token=? AND intent_published=0 AND child_json IS NULL
        AND staged_identity_json IS NULL AND staged_sealed_envelope IS NULL AND staged_capability_hash IS NULL`)
      .run(identityJson, sealedEnvelope, capabilityHash, now, decisionId, token)
    if (Number(result.changes) !== 1) throw new ApprovedDecisionStoreError('conflict')
  }

  readStagedIntent(decisionId: string, token: string): {
    identity: ReturnType<typeof CloudJobAdamBindingIdentity.parse>
    sealedEnvelope: string
    capabilityHash: string
  } | null {
    const row = this.get(decisionId)
    if (!row || row.lease_token !== token) throw new ApprovedDecisionStoreError('conflict')
    const parts = [row.staged_identity_json, row.staged_sealed_envelope, row.staged_capability_hash]
    if (parts.every((part) => part === null)) return null
    try {
      if (parts.some((part) => part === null)) throw new Error('partial stage')
      const identity = CloudJobAdamBindingIdentity.parse(JSON.parse(row.staged_identity_json!))
      if (canonicalCloudJobAdamJson(identity) !== row.staged_identity_json ||
          !/^[a-f0-9]{64}$/.test(row.staged_capability_hash!) ||
          !AdamCloudSealedEnvelope.safeParse(row.staged_sealed_envelope).success ||
          identity.projectId !== row.project_id || identity.parentObjectiveId !== row.parent_objective_id ||
          identity.parentObjectiveVersion !== row.parent_objective_version || identity.contextDigest !== row.context_digest ||
          identity.requestFingerprint !== row.approved_payload_digest || identity.expiresAtMs !== row.intent_expires_at_ms ||
          identity.adamInstanceId.length === 0) throw new Error('invalid stage')
      return { identity, sealedEnvelope: row.staged_sealed_envelope!, capabilityHash: row.staged_capability_hash! }
    } catch { throw new ApprovedDecisionStoreError('conflict') }
  }

  markIntentPublished(decisionId: string, token: string, now: number): void {
    assertTime(now)
    const result = this.db.prepare(`UPDATE dobius_cloud_approved_decisions SET intent_published=1,updated_at_ms=?
      WHERE decision_id=? AND lease_token=? AND child_json IS NULL`).run(now, decisionId, token)
    if (Number(result.changes) !== 1) throw new ApprovedDecisionStoreError('conflict')
  }

  markChildSubmitted(decisionId: string, token: string, child: unknown, now: number): void {
    const childJson = canonicalCloudJobAdamJson(child)
    assertTime(now)
    const result = this.db.prepare(`UPDATE dobius_cloud_approved_decisions SET intent_published=1,child_json=?,
      lease_token=NULL,lease_until_ms=NULL,updated_at_ms=? WHERE decision_id=? AND lease_token=? AND child_json IS NULL`)
      .run(childJson, now, decisionId, token)
    if (Number(result.changes) !== 1) throw new ApprovedDecisionStoreError('conflict')
  }

  releasePublishedAttempt(decisionId: string, token: string, now: number): void {
    assertTime(now)
    const result = this.db.prepare(`UPDATE dobius_cloud_approved_decisions SET lease_token=NULL,lease_until_ms=NULL,updated_at_ms=?
      WHERE decision_id=? AND lease_token=? AND intent_published=1 AND child_json IS NULL`).run(now, decisionId, token)
    if (Number(result.changes) !== 1) throw new ApprovedDecisionStoreError('conflict')
  }

  private transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const value = action(); this.db.exec('COMMIT'); return value }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
}

function assertTime(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new ApprovedDecisionStoreError('invalid')
}
