import { sha256 } from '@noble/hashes/sha256'
import { z } from 'zod'
import { CloudId, CloudJobState } from './cloud-jobs'

const SafeTime = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const Sha256 = z.string().regex(/^[a-f0-9]{64}$/)
const Uuid = z.string().uuid()

export const CloudJobAdamBindingGrant = z
  .object({
    schemaVersion: z.literal(1),
    bindingId: Uuid,
    capability: z.string().min(32).max(512),
    adamInstanceId: CloudId,
    parentObjectiveId: CloudId,
    parentObjectiveVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    projectId: CloudId,
    contextDigest: Sha256,
    requestFingerprint: Sha256,
    expiresAtMs: SafeTime
  })
  .strict()
export type CloudJobAdamBindingGrant = z.infer<typeof CloudJobAdamBindingGrant>

export const CloudJobAdamBindingIdentity = z
  .object({
    schemaVersion: z.literal(1),
    bindingId: Uuid,
    adamInstanceId: CloudId,
    parentObjectiveId: CloudId,
    parentObjectiveVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    projectId: CloudId,
    contextDigest: Sha256,
    requestFingerprint: Sha256,
    expiresAtMs: SafeTime
  })
  .strict()
export type CloudJobAdamBindingIdentity = z.infer<typeof CloudJobAdamBindingIdentity>

export const CloudJobAdamBindingConsumeRequest = z
  .object({
    schemaVersion: z.literal(1),
    capability: z.string().min(32).max(512),
    binding: CloudJobAdamBindingIdentity
  })
  .strict()
export type CloudJobAdamBindingConsumeRequest = z.infer<typeof CloudJobAdamBindingConsumeRequest>

export const CloudJobAdamBindingResponse = z
  .object({
    schemaVersion: z.literal(1),
    consumed: z.literal(true),
    binding: CloudJobAdamBindingIdentity,
    boundAtMs: SafeTime,
    bindingDigest: Sha256
  })
  .strict()
export type CloudJobAdamBindingResponse = z.infer<typeof CloudJobAdamBindingResponse>

export const CloudJobAdamEvidenceDigest = z.object({ evidenceId: CloudId, sha256: Sha256 }).strict()

export const CloudJobAdamReceipt = z
  .object({
    schemaVersion: z.literal(1),
    receiptId: Uuid,
    bindingId: Uuid,
    adamInstanceId: CloudId,
    parentObjectiveId: CloudId,
    parentObjectiveVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    cloudJobId: Uuid,
    cloudJobVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    cloudEventSequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    attemptId: Uuid.nullable(),
    attemptNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
    eventKind: z.enum([
      'submitted',
      'attempt_started',
      'execution_needs_review',
      'execution_failed',
      'cancellation_requested',
      'process_stopped',
      'interrupted',
      'retry_queued',
      'review_accepted'
    ]),
    cloudJobState: CloudJobState,
    projectId: CloudId,
    contextDigest: Sha256,
    evidenceDigests: z.array(CloudJobAdamEvidenceDigest).max(50),
    occurredAtMs: SafeTime
  })
  .strict()
  .superRefine((receipt, context) => {
    if ((receipt.attemptId === null) !== (receipt.attemptNumber === null)) {
      context.addIssue({ code: 'custom', message: 'Attempt identity and number must be paired.' })
    }
    if (
      receipt.eventKind === 'execution_needs_review' &&
      receipt.cloudJobState !== 'needs_review'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Successful execution remains awaiting child review.'
      })
    }
    if (receipt.eventKind === 'review_accepted' && receipt.cloudJobState !== 'completed') {
      context.addIssue({
        code: 'custom',
        message: 'Accepted review requires a completed child job.'
      })
    }
  })
export type CloudJobAdamReceipt = z.infer<typeof CloudJobAdamReceipt>

export const CloudJobAdamReceiptRequest = z
  .object({ schemaVersion: z.literal(1), receipt: CloudJobAdamReceipt, payloadSha256: Sha256 })
  .strict()
export type CloudJobAdamReceiptRequest = z.infer<typeof CloudJobAdamReceiptRequest>

export const CloudJobAdamReceiptAck = z
  .object({
    schemaVersion: z.literal(1),
    ok: z.literal(true),
    receiptId: Uuid,
    payloadSha256: Sha256,
    accepted: z.enum(['inserted', 'duplicate']),
    storedAtMs: SafeTime,
    parentStateChanged: z.literal(false)
  })
  .strict()
export type CloudJobAdamReceiptAck = z.infer<typeof CloudJobAdamReceiptAck>

export const CLOUD_JOB_ADAM_MAX_CANONICAL_BYTES = 64 * 1024

/** Canonical JSON used for digests; schemas must be parsed before calling this. */
export function canonicalCloudJobAdamJson(value: unknown): string {
  const json = canonicalValue(value, new Set())
  if (new TextEncoder().encode(json).byteLength > CLOUD_JOB_ADAM_MAX_CANONICAL_BYTES) {
    throw new RangeError('ADAM receipt payload exceeds the canonical size limit.')
  }
  return json
}

export function canonicalCloudJobAdamSha256(value: unknown): string {
  return Array.from(sha256(new TextEncoder().encode(canonicalCloudJobAdamJson(value))))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function canonicalValue(value: unknown, ancestors: Set<object>): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      throw new TypeError('Circular ADAM payload.')
    }
    ancestors.add(value)
    const result = `[${value.map((item) => canonicalValue(item, ancestors)).join(',')}]`
    ancestors.delete(value)
    return result
  }
  if (typeof value === 'object' && value !== null) {
    if (ancestors.has(value) || Object.getPrototypeOf(value) !== Object.prototype) {
      throw new TypeError('ADAM payload must contain plain JSON objects.')
    }
    ancestors.add(value)
    const entries = Object.keys(value)
      .sort()
      .map((key) => {
        const item = (value as Record<string, unknown>)[key]
        if (item === undefined) {
          throw new TypeError('Undefined is not canonical JSON.')
        }
        return `${JSON.stringify(key)}:${canonicalValue(item, ancestors)}`
      })
    ancestors.delete(value)
    return `{${entries.join(',')}}`
  }
  throw new TypeError('ADAM payload contains a non-JSON value.')
}
