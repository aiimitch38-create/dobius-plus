import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { AdamDatabase } from '../db/database.js'
import {
  assertApprovedPayload,
  existingIntentResult,
  issueApprovedJobGrantWithIntent as publishApprovedJobGrantWithIntent,
  issueGrantWithIntent as publishGrantWithIntent,
  type IntentPublicationContext,
  type IntentRow
} from './intent-publication.js'
import type { AdamCloudIntentResult, AdamCloudIntentSealer } from './intent-contract.js'
import { parseCanonicalApprovedJobPayload } from './approved-job-payload.js'
import {
  CloudJobAdamBindingIdentity, CloudJobAdamBindingConsumeRequest,
  CloudJobAdamReceiptRequest, CloudJobAdamBindingResponse, CloudJobAdamReceiptAck,
  canonicalCloudJobAdamJson, canonicalCloudJobAdamSha256, type CloudJobAdamBindingGrant
} from './receipt-contract.js'

export class CloudReceiptError extends Error {
  constructor(readonly code: 'invalid' | 'expired' | 'conflict' | 'missing') { super(code) }
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex')

/** Receipts are observations only: this store never transitions a parent job. */
export class DobiusCloudReceiptStore {
  readonly instanceId: string
  constructor(private readonly db: AdamDatabase, private readonly now = Date.now) {
    db.prepare("INSERT OR IGNORE INTO dobius_cloud_metadata VALUES ('instance_id',?)").run(randomUUID())
    this.instanceId = String(db.prepare("SELECT value FROM dobius_cloud_metadata WHERE key='instance_id'").get()!.value)
  }

  /** Internal parent planner API, deliberately absent from public HTTP/RPC routes. */
  issueGrant(input: {
    parentObjectiveId: string; parentObjectiveVersion: number; projectId: string;
    contextDigest: string; requestFingerprint: string; ttlMs: number
  }): CloudJobAdamBindingGrant {
    return this.transaction(() => {
      const at = this.now()
      if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs < 1000 || input.ttlMs > 300_000) {
        throw new CloudReceiptError('invalid')
      }
      const parent = this.parent(input.parentObjectiveId)
      if (parent.project_id !== input.projectId || Number(parent.revision) !== input.parentObjectiveVersion ||
          ['completed', 'reported', 'failed', 'cancelled'].includes(String(parent.state))) {
        throw new CloudReceiptError('conflict')
      }
      const identity = CloudJobAdamBindingIdentity.parse({
        schemaVersion: 1, bindingId: randomUUID(), adamInstanceId: this.instanceId,
        parentObjectiveId: input.parentObjectiveId, parentObjectiveVersion: input.parentObjectiveVersion,
        projectId: input.projectId, contextDigest: input.contextDigest,
        requestFingerprint: input.requestFingerprint, expiresAtMs: at + input.ttlMs
      })
      const capability = randomBytes(32).toString('base64url')
      this.db.prepare(`INSERT INTO dobius_cloud_bindings
        (binding_id,parent_job_id,identity_json,identity_digest,capability_hash,expires_at_ms)
        VALUES (?,?,?,?,?,?)`).run(identity.bindingId, input.parentObjectiveId,
          canonicalCloudJobAdamJson(identity), canonicalCloudJobAdamSha256(identity), hash(capability), identity.expiresAtMs)
      return { ...identity, capability }
    })
  }

  /** Internal source candidate: seal first, then publish binding and intent atomically. */
  issueGrantWithIntent(input: {
    intentId: string; parentObjectiveId: string; parentObjectiveVersion: number; projectId: string;
    contextDigest: string; requestFingerprint: string; ttlMs: number
  }, sealEnvelope: AdamCloudIntentSealer): Promise<AdamCloudIntentResult> {
    return publishGrantWithIntent(this.publicationContext(), input, sealEnvelope)
  }

  /** Canonical JSON input keeps untrusted object accessors outside the approval parser. */
  issueApprovedJobGrantWithIntent(rawApprovedRequest: unknown, sealEnvelope: AdamCloudIntentSealer): Promise<AdamCloudIntentResult> {
    return publishApprovedJobGrantWithIntent(this.publicationContext(), rawApprovedRequest, sealEnvelope)
  }

  private publicationContext(): IntentPublicationContext {
    return {
      instanceId: this.instanceId,
      now: this.now,
      parent: (id) => this.parent(id),
      readIntent: (intentId) => this.readIntentRow(intentId),
      fail: (code) => { throw new CloudReceiptError(code) },
      publish: (publication) => {
        try { return this.transaction(() => {
        const existing = this.readIntentRow(publication.request.intentId)
        if (existing) {
          const result = existingIntentResult(existing, publication.request, publication.requestJson, publication.requestDigest,
            this.instanceId, (code) => { throw new CloudReceiptError(code) })
          if (publication.approvedPayloadJson !== undefined && publication.approvedPayloadDigest !== undefined) {
            assertApprovedPayload(existing, {
              approvedPayloadJson: publication.approvedPayloadJson,
              approvedPayloadDigest: publication.approvedPayloadDigest
            }, (code) => { throw new CloudReceiptError(code) })
          }
          return result
        }
        const instance = this.db.prepare("SELECT value FROM dobius_cloud_metadata WHERE key='instance_id'").get()
        if (String(instance?.value) !== this.instanceId) throw new CloudReceiptError('conflict')
        const parent = this.parent(publication.request.parentObjectiveId)
        if (parent.project_id !== publication.request.projectId ||
            Number(parent.revision) !== publication.request.parentObjectiveVersion ||
            ['completed', 'reported', 'failed', 'cancelled'].includes(String(parent.state))) {
          throw new CloudReceiptError('conflict')
        }
        const at = this.now()
        if (!Number.isSafeInteger(at) || at < publication.issuedAtMs) throw new CloudReceiptError('invalid')
        if (at >= publication.identity.expiresAtMs) throw new CloudReceiptError('expired')
        this.db.prepare(`INSERT INTO dobius_cloud_bindings
          (binding_id,parent_job_id,identity_json,identity_digest,capability_hash,expires_at_ms)
          VALUES (?,?,?,?,?,?)`).run(publication.identity.bindingId, publication.request.parentObjectiveId,
            publication.identityJson, publication.identityDigest, publication.capabilityHash, publication.identity.expiresAtMs)
        this.db.prepare(`INSERT INTO dobius_cloud_intents
          (intent_id,binding_id,request_identity_json,request_identity_digest,identity_json,identity_digest,
           sealed_envelope,state,created_at_ms,expires_at_ms,approved_payload_json,approved_payload_digest)
          VALUES (?,?,?,?,?,?,?,'pending',?,?,?,?)`).run(publication.request.intentId, publication.identity.bindingId,
            publication.requestJson, publication.requestDigest, publication.identityJson, publication.identityDigest,
            publication.sealedEnvelope, at, publication.identity.expiresAtMs,
            publication.approvedPayloadJson ?? null, publication.approvedPayloadDigest ?? null)
        return { status: 'issued', grant: { ...publication.identity, capability: publication.capability } }
        }) } catch (error) {
          if (error instanceof CloudReceiptError) throw error
          throw new CloudReceiptError('invalid')
        }
      }
    }
  }

  consume(raw: unknown): CloudJobAdamBindingResponse {
    const request = CloudJobAdamBindingConsumeRequest.safeParse(raw)
    if (!request.success) throw new CloudReceiptError('invalid')
    return this.transaction(() => {
      const { binding, capability } = request.data
      const row = this.db.prepare('SELECT * FROM dobius_cloud_bindings WHERE binding_id=?').get(binding.bindingId)
      if (!row) throw new CloudReceiptError('missing')
      const expectedHash = Buffer.from(String(row.capability_hash), 'hex')
      const suppliedHash = Buffer.from(hash(capability), 'hex')
      if (expectedHash.length !== suppliedHash.length || !timingSafeEqual(expectedHash, suppliedHash) ||
          row.identity_json !== canonicalCloudJobAdamJson(binding) || binding.adamInstanceId !== this.instanceId) {
        throw new CloudReceiptError('conflict')
      }
      const approvedIntent = this.db.prepare(`SELECT approved_payload_json,approved_payload_digest
        FROM dobius_cloud_intents WHERE binding_id=?`).get(binding.bindingId) as
        { approved_payload_json: string | null; approved_payload_digest: string | null } | undefined
      if (approvedIntent) {
        try {
          const payload = parseCanonicalApprovedJobPayload(approvedIntent.approved_payload_json)
          if (payload.digest !== approvedIntent.approved_payload_digest || payload.digest !== binding.requestFingerprint) {
            throw new Error('payload mismatch')
          }
        } catch {
          throw new CloudReceiptError('conflict')
        }
      }
      // Exact consumed replay does not mint another binding or mutate the parent.
      if (row.response_json !== null) return CloudJobAdamBindingResponse.parse(JSON.parse(String(row.response_json)))
      const parent = this.parent(binding.parentObjectiveId)
      if (parent.project_id !== binding.projectId || Number(parent.revision) !== binding.parentObjectiveVersion ||
          ['completed', 'reported', 'failed', 'cancelled'].includes(String(parent.state))) {
        throw new CloudReceiptError('conflict')
      }
      const at = this.now()
      if (at >= Number(row.expires_at_ms)) throw new CloudReceiptError('expired')
      const response: CloudJobAdamBindingResponse = { schemaVersion: 1, consumed: true,
        binding, boundAtMs: at, bindingDigest: String(row.identity_digest) }
      this.db.prepare('UPDATE dobius_cloud_bindings SET consumed_at_ms=?, response_json=? WHERE binding_id=?')
        .run(at, canonicalCloudJobAdamJson(response), binding.bindingId)
      return response
    })
  }

  receive(raw: unknown) {
    const request = CloudJobAdamReceiptRequest.safeParse(raw)
    if (!request.success || request.data.payloadSha256 !== canonicalCloudJobAdamSha256(request.data.receipt)) {
      throw new CloudReceiptError('invalid')
    }
    return this.transaction(() => {
      const { receipt, payloadSha256 } = request.data
      const existing = this.db.prepare('SELECT * FROM dobius_cloud_receipts WHERE receipt_id=?').get(receipt.receiptId)
      if (existing) {
        if (existing.payload_sha256 !== payloadSha256 || existing.payload_json !== canonicalCloudJobAdamJson(receipt)) {
          throw new CloudReceiptError('conflict')
        }
        return { ...CloudJobAdamReceiptAck.parse(JSON.parse(String(existing.ack_json))), accepted: 'duplicate' as const }
      }
      const row = this.db.prepare('SELECT * FROM dobius_cloud_bindings WHERE binding_id=?').get(receipt.bindingId)
      if (!row || row.consumed_at_ms === null) throw new CloudReceiptError('missing')
      const identity = CloudJobAdamBindingIdentity.parse(JSON.parse(String(row.identity_json)))
      this.parent(identity.parentObjectiveId)
      if (receipt.adamInstanceId !== this.instanceId || receipt.parentObjectiveId !== identity.parentObjectiveId ||
          receipt.parentObjectiveVersion !== identity.parentObjectiveVersion || receipt.projectId !== identity.projectId ||
          receipt.contextDigest !== identity.contextDigest) throw new CloudReceiptError('conflict')
      const prior = this.db.prepare(`SELECT cloud_job_id,cloud_event_sequence FROM dobius_cloud_receipts
        WHERE binding_id=? ORDER BY cloud_event_sequence DESC LIMIT 1`).get(receipt.bindingId)
      if (prior && (prior.cloud_job_id !== receipt.cloudJobId || Number(prior.cloud_event_sequence) >= receipt.cloudEventSequence)) {
        throw new CloudReceiptError('conflict')
      }
      const ack = { schemaVersion: 1, ok: true as const, receiptId: receipt.receiptId, payloadSha256,
        accepted: 'inserted' as const, storedAtMs: this.now(), parentStateChanged: false as const }
      this.db.prepare(`INSERT INTO dobius_cloud_receipts
        (receipt_id,binding_id,cloud_job_id,cloud_event_sequence,payload_json,payload_sha256,ack_json,received_at_ms)
        VALUES (?,?,?,?,?,?,?,?)`).run(receipt.receiptId, receipt.bindingId, receipt.cloudJobId, receipt.cloudEventSequence,
          canonicalCloudJobAdamJson(receipt), payloadSha256, canonicalCloudJobAdamJson(ack), ack.storedAtMs)
      return ack
    })
  }

  private parent(id: string): Record<string, unknown> {
    const parent = this.db.prepare(`SELECT j.*,r.revision FROM jobs j JOIN dobius_parent_revisions r
      ON r.job_id=j.id WHERE j.id=?`).get(id)
    if (!parent) throw new CloudReceiptError('missing')
    return parent
  }

  private readIntentRow(intentId: string): IntentRow | undefined {
    return this.db.prepare(`SELECT i.intent_id,i.binding_id,i.request_identity_json,i.request_identity_digest,
      i.identity_json AS intent_identity_json,i.identity_digest,i.sealed_envelope,i.state,i.created_at_ms,i.expires_at_ms,
      i.approved_payload_json,i.approved_payload_digest,
      b.parent_job_id,b.identity_json AS binding_identity_json,b.identity_digest AS binding_identity_digest,
      b.expires_at_ms AS binding_expires_at_ms,m.value AS persisted_instance_id
      FROM dobius_cloud_intents i
      LEFT JOIN dobius_cloud_bindings b ON b.binding_id=i.binding_id
      LEFT JOIN dobius_cloud_metadata m ON m.key='instance_id'
      WHERE i.intent_id=?`).get(intentId) as IntentRow | undefined
  }

  private transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const value = action(); this.db.exec('COMMIT'); return value }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
}
