import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  AdamCloudIntentEnvelope, AdamCloudIntentRequest, AdamCloudSealedEnvelope,
  type AdamCloudIntentResult, type AdamCloudIntentSealer
} from './intent-contract.js'
import {
  canonicalCloudJobAdamJson, canonicalCloudJobAdamSha256, CloudJobAdamBindingIdentity
} from './receipt-contract.js'

export type IntentPublicationContext = {
  instanceId: string
  now: () => number
  parent: (id: string) => Record<string, unknown>
  readIntent: (intentId: string) => IntentRow | undefined
  fail: (code: 'invalid' | 'expired' | 'conflict' | 'missing') => never
  publish: (input: {
    request: AdamCloudIntentRequest
    requestJson: string
    requestDigest: string
    identity: CloudJobAdamBindingIdentity
    identityJson: string
    identityDigest: string
    capability: string
    capabilityHash: string
    sealedEnvelope: string
    issuedAtMs: number
  }) => AdamCloudIntentResult
}

export type IntentRow = Record<string, unknown>

export async function issueGrantWithIntent(
  context: IntentPublicationContext,
  rawRequest: unknown,
  sealer: AdamCloudIntentSealer
): Promise<AdamCloudIntentResult> {
  const parsed = AdamCloudIntentRequest.safeParse(rawRequest)
  if (!parsed.success || typeof sealer !== 'function') context.fail('invalid')
  const request = parsed.data
  const requestJson = canonicalCloudJobAdamJson(request)
  const requestDigest = canonicalCloudJobAdamSha256(request)
  const existing = context.readIntent(request.intentId)
  if (existing) return existingIntentResult(existing, request, requestJson, requestDigest, context.instanceId, context.fail)

  const issuedAtMs = context.now()
  if (!Number.isSafeInteger(issuedAtMs) || issuedAtMs < 0) context.fail('invalid')
  const expiresAtMs = issuedAtMs + request.ttlMs
  if (!Number.isSafeInteger(expiresAtMs)) context.fail('invalid')
  const parent = context.parent(request.parentObjectiveId)
  assertParent(request, parent, context.fail)
  const identity = Object.freeze(CloudJobAdamBindingIdentity.parse({
    schemaVersion: 1,
    bindingId: randomUUID(),
    adamInstanceId: context.instanceId,
    parentObjectiveId: request.parentObjectiveId,
    parentObjectiveVersion: request.parentObjectiveVersion,
    projectId: request.projectId,
    contextDigest: request.contextDigest,
    requestFingerprint: request.requestFingerprint,
    expiresAtMs
  }))
  const capability = randomBytes(32).toString('base64url')
  const envelope = Object.freeze(AdamCloudIntentEnvelope.parse({
    schemaVersion: 1, intentId: request.intentId, identity, capability
  }))
  let sealed: unknown
  try { sealed = await sealer(envelope) } catch { context.fail('invalid') }
  const sealedResult = AdamCloudSealedEnvelope.safeParse(sealed)
  if (!sealedResult.success || sealedResult.data === capability || sealedResult.data.includes(capability)) {
    context.fail('invalid')
  }
  const identityJson = canonicalCloudJobAdamJson(identity)
  const identityDigest = canonicalCloudJobAdamSha256(identity)
  return context.publish({
    request, requestJson, requestDigest, identity, identityJson, identityDigest, capability,
    capabilityHash: createHash('sha256').update(capability).digest('hex'), sealedEnvelope: sealedResult.data, issuedAtMs
  })
}

export function existingIntentResult(
  row: IntentRow,
  request: AdamCloudIntentRequest,
  requestJson: string,
  requestDigest: string,
  instanceId: string,
  fail: IntentPublicationContext['fail']
): AdamCloudIntentResult {
  try {
    // A stable request key cannot authorize replay from a copied or rebound ADAM database.
    const identity = CloudJobAdamBindingIdentity.parse(JSON.parse(String(row.intent_identity_json)))
    const bindingIdentity = CloudJobAdamBindingIdentity.parse(JSON.parse(String(row.binding_identity_json)))
    const identityJson = canonicalCloudJobAdamJson(identity)
    const identityDigest = canonicalCloudJobAdamSha256(identity)
    const expiresAtMs = Number(row.expires_at_ms)
    const bindingExpiry = Number(row.binding_expires_at_ms)
    const createdAtMs = Number(row.created_at_ms)
    if (row.request_identity_json !== requestJson || row.request_identity_digest !== requestDigest ||
        row.intent_id !== request.intentId || row.binding_id !== identity.bindingId ||
        row.intent_identity_json !== identityJson || row.binding_identity_json !== identityJson ||
        row.identity_digest !== identityDigest || row.binding_identity_digest !== identityDigest ||
        row.persisted_instance_id !== instanceId || identity.adamInstanceId !== instanceId ||
        row.parent_job_id !== request.parentObjectiveId || bindingIdentity.parentObjectiveId !== request.parentObjectiveId ||
        identity.parentObjectiveId !== request.parentObjectiveId ||
        identity.parentObjectiveVersion !== request.parentObjectiveVersion ||
        identity.projectId !== request.projectId || identity.contextDigest !== request.contextDigest ||
        identity.requestFingerprint !== request.requestFingerprint ||
        !Number.isSafeInteger(expiresAtMs) || expiresAtMs !== identity.expiresAtMs ||
        bindingExpiry !== identity.expiresAtMs || !Number.isSafeInteger(createdAtMs) || createdAtMs < 0 ||
        createdAtMs > identity.expiresAtMs || row.state !== 'pending' ||
        !AdamCloudSealedEnvelope.safeParse(row.sealed_envelope).success) {
      fail('conflict')
    }
    return { status: 'existing', intentId: request.intentId, bindingId: identity.bindingId, expiresAtMs }
  } catch {
    fail('conflict')
  }
}

export function assertParent(request: AdamCloudIntentRequest, parent: Record<string, unknown>, fail: IntentPublicationContext['fail']): void {
  if (parent.project_id !== request.projectId || Number(parent.revision) !== request.parentObjectiveVersion ||
      ['completed', 'reported', 'failed', 'cancelled'].includes(String(parent.state))) {
    fail('conflict')
  }
}
