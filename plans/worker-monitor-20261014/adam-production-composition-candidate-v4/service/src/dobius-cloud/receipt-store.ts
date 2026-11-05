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
import { AdamCloudIntentRequest, AdamCloudSealedEnvelope } from './intent-contract.js'
import { parseApprovedJobIntent, parseCanonicalApprovedJobPayload } from './approved-job-payload.js'
import {
  CloudJobAdamBindingIdentity, CloudJobAdamBindingConsumeRequest,
  CloudJobAdamReceiptRequest, CloudJobAdamBindingResponse, CloudJobAdamReceiptAck,
  canonicalCloudJobAdamJson, canonicalCloudJobAdamSha256, type CloudJobAdamBindingGrant
} from './receipt-contract.js'

export class CloudReceiptError extends Error {
  constructor(readonly code: 'invalid' | 'expired' | 'conflict' | 'missing') { super(code) }
}

export type DurableApprovedIntentSubmission = {
  schemaVersion: 1
  intentId: string
  identity: ReturnType<typeof CloudJobAdamBindingIdentity.parse>
  sealedEnvelope: string
  approvedJob: ReturnType<typeof parseCanonicalApprovedJobPayload>['approvedJob']
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
  }, sealEnvelope: AdamCloudIntentSealer, beforePublish?: () => void): Promise<AdamCloudIntentResult> {
    return publishGrantWithIntent(this.publicationContext(beforePublish), input, sealEnvelope)
  }

  /** Canonical JSON input keeps untrusted object accessors outside the approval parser. */
  issueApprovedJobGrantWithIntent(
    rawApprovedRequest: unknown,
    sealEnvelope: AdamCloudIntentSealer,
    beforePublish?: () => void,
    fixedExpiresAtMs?: number
  ): Promise<AdamCloudIntentResult> {
    return publishApprovedJobGrantWithIntent(this.publicationContext(beforePublish), rawApprovedRequest, sealEnvelope,
      fixedExpiresAtMs)
  }

  /** Commit a previously sealed exact intent after a crash between sealing and the atomic binding write. */
  publishStagedApprovedJobGrantWithIntent(
    rawApprovedRequest: unknown,
    stage: { identity: unknown; sealedEnvelope: unknown; capabilityHash: unknown },
    beforePublish?: () => void
  ): AdamCloudIntentResult {
    let approved: ReturnType<typeof parseApprovedJobIntent>
    let identity: ReturnType<typeof CloudJobAdamBindingIdentity.parse>
    let sealedEnvelope: string
    try {
      approved = parseApprovedJobIntent(rawApprovedRequest)
      identity = CloudJobAdamBindingIdentity.parse(stage.identity)
      sealedEnvelope = AdamCloudSealedEnvelope.parse(stage.sealedEnvelope)
    } catch { throw new CloudReceiptError('invalid') }
    const capabilityHash = stage.capabilityHash
    const at = this.now()
    const expiresAtMs = identity.expiresAtMs
    if (typeof capabilityHash !== 'string' || !/^[a-f0-9]{64}$/.test(capabilityHash) ||
        !Number.isSafeInteger(at) || at < 0 || expiresAtMs <= at ||
        expiresAtMs > at + approved.request.ttlMs || identity.adamInstanceId !== this.instanceId ||
        identity.parentObjectiveId !== approved.request.parentObjectiveId ||
        identity.parentObjectiveVersion !== approved.request.parentObjectiveVersion ||
        identity.projectId !== approved.request.projectId || identity.contextDigest !== approved.request.contextDigest ||
        identity.requestFingerprint !== approved.request.requestFingerprint) throw new CloudReceiptError('conflict')
    const identityJson = canonicalCloudJobAdamJson(identity)
    const identityDigest = canonicalCloudJobAdamSha256(identity)
    return this.publicationContext(beforePublish).publish({
      request: approved.request,
      requestJson: approved.requestJson,
      requestDigest: approved.requestDigest,
      identity,
      identityJson,
      identityDigest,
      capabilityHash,
      sealedEnvelope,
      issuedAtMs: at,
      approvedPayloadJson: approved.approvedPayloadJson,
      approvedPayloadDigest: approved.approvedPayloadDigest
    })
  }

  /** Read only the durable sealed material needed for same-intent retry; capability is never returned. */
  readApprovedIntentForSubmission(intentId: string): DurableApprovedIntentSubmission {
    const row = this.findIntentRow(intentId)
    try {
      if (!row || row.state !== 'pending' || typeof row.intent_id !== 'string' || row.intent_id !== intentId) {
        throw new Error('missing intent')
      }
      const identity = CloudJobAdamBindingIdentity.parse(JSON.parse(String(row.intent_identity_json)))
      const bindingIdentity = CloudJobAdamBindingIdentity.parse(JSON.parse(String(row.binding_identity_json)))
      const payload = parseCanonicalApprovedJobPayload(row.approved_payload_json)
      const parsedRequest = AdamCloudIntentRequest.parse(JSON.parse(String(row.request_identity_json)))
      if (canonicalCloudJobAdamJson(identity) !== row.intent_identity_json ||
          canonicalCloudJobAdamJson(bindingIdentity) !== row.binding_identity_json ||
          canonicalCloudJobAdamJson(identity) !== canonicalCloudJobAdamJson(bindingIdentity) ||
          row.persisted_instance_id !== this.instanceId || identity.adamInstanceId !== this.instanceId ||
          identity.projectId !== payload.projectId || parsedRequest.projectId !== identity.projectId ||
          parsedRequest.requestFingerprint !== identity.requestFingerprint ||
          payload.digest !== identity.requestFingerprint || payload.digest !== row.approved_payload_digest ||
          row.request_identity_digest !== canonicalCloudJobAdamSha256(parsedRequest) ||
          identity.parentObjectiveId !== parsedRequest.parentObjectiveId ||
          identity.parentObjectiveVersion !== parsedRequest.parentObjectiveVersion ||
          identity.contextDigest !== parsedRequest.contextDigest ||
          identity.expiresAtMs !== Number(row.expires_at_ms) ||
          row.binding_expires_at_ms !== row.expires_at_ms ||
          row.binding_id !== identity.bindingId || row.identity_digest !== row.binding_identity_digest) {
        throw new Error('mismatched intent')
      }
      const sealedEnvelope = AdamCloudSealedEnvelope.parse(row.sealed_envelope)
      return { schemaVersion: 1, intentId, identity, sealedEnvelope, approvedJob: payload.approvedJob }
    } catch {
      throw new CloudReceiptError('conflict')
    }
  }

  /** A missing intent is distinct from a corrupt durable intent during recovery. */
  findApprovedIntentForSubmission(intentId: string): DurableApprovedIntentSubmission | null {
    if (typeof intentId !== 'string' || !/^[0-9a-f-]{36}$/i.test(intentId)) throw new CloudReceiptError('invalid')
    const row = this.findIntentRow(intentId)
    if (!row) return null
    return this.readApprovedIntentForSubmission(intentId)
  }

  private publicationContext(beforePublish?: () => void): IntentPublicationContext {
    return {
      instanceId: this.instanceId,
      now: this.now,
      parent: (id) => this.parent(id),
      readIntent: (intentId) => this.readIntentRow(intentId),
      fail: (code) => { throw new CloudReceiptError(code) },
      ...(beforePublish ? { beforePublish } : {}),
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
        return publication.capability === undefined
          ? { status: 'published', intentId: publication.request.intentId,
              bindingId: publication.identity.bindingId, expiresAtMs: publication.identity.expiresAtMs }
          : { status: 'issued', grant: { ...publication.identity, capability: publication.capability } }
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
          if (payload.projectId !== binding.projectId ||
              payload.digest !== approvedIntent.approved_payload_digest || payload.digest !== binding.requestFingerprint) {
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

  private findIntentRow(intentId: string): IntentRow | undefined {
    return this.readIntentRow(intentId)
  }

  private transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const value = action(); this.db.exec('COMMIT'); return value }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
}
