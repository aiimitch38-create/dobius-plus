import { z } from 'zod'
import {
  CLOUD_JOB_ADAM_MAX_CANONICAL_BYTES,
  canonicalCloudJobAdamJson,
  canonicalCloudJobAdamSha256
} from './receipt-contract.js'
import { AdamCloudIntentRequest } from './intent-contract.js'

const CloudId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/)

export const ApprovedJobPayload = z.object({
  requestKey: CloudId,
  taskId: CloudId,
  projectId: CloudId,
  workspaceId: CloudId,
  targetDeviceId: CloudId,
  recipeId: CloudId,
  title: z.string().trim().min(1).max(200),
  sourceRevision: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
  estimatedBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  dependencies: z.array(CloudId).max(50).default([])
}).strict()

export const ApprovedJobIntentRequest = AdamCloudIntentRequest.extend({
  approvedJob: ApprovedJobPayload
}).strict()

export type ApprovedJobPayload = z.infer<typeof ApprovedJobPayload>
export type ApprovedJobIntentRequest = z.infer<typeof ApprovedJobIntentRequest>

export type ParsedApprovedJobIntent = {
  request: z.infer<typeof AdamCloudIntentRequest>
  requestJson: string
  requestDigest: string
  approvedPayloadJson: string
  approvedPayloadDigest: string
}

export function parseCanonicalApprovedJobPayload(raw: unknown): {
  json: string
  digest: string
  projectId: string
  approvedJob: ApprovedJobPayload
} {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > CLOUD_JOB_ADAM_MAX_CANONICAL_BYTES ||
      Buffer.from(raw, 'utf8').toString('utf8') !== raw) {
    throw new TypeError('invalid approved payload')
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  } catch {
    throw new TypeError('invalid approved payload')
  }
  const parsed = ApprovedJobPayload.safeParse(decoded)
  if (!parsed.success) throw new TypeError('invalid approved payload')
  const json = canonicalCloudJobAdamJson(parsed.data)
  const digest = canonicalCloudJobAdamSha256(parsed.data)
  if (json !== raw) throw new TypeError('invalid approved payload')
  return { json, digest, projectId: parsed.data.projectId, approvedJob: parsed.data }
}

/** String input prevents object accessors/proxies and canonical equality rejects duplicate keys. */
export function parseApprovedJobIntent(raw: unknown): ParsedApprovedJobIntent {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > CLOUD_JOB_ADAM_MAX_CANONICAL_BYTES) {
    throw new TypeError('invalid approved intent')
  }
  if (Buffer.from(raw, 'utf8').toString('utf8') !== raw) throw new TypeError('invalid approved intent')
  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  } catch {
    throw new TypeError('invalid approved intent')
  }
  const parsed = ApprovedJobIntentRequest.safeParse(decoded)
  if (!parsed.success) throw new TypeError('invalid approved intent')
  const canonicalRequest = canonicalCloudJobAdamJson(parsed.data)
  if (canonicalRequest !== raw) throw new TypeError('invalid approved intent')

  const { approvedJob, ...request } = parsed.data
  // The parent authorization covers request.projectId, so the approved child
  // must be in that same project before any capability is sealed.
  if (approvedJob.projectId !== request.projectId) throw new TypeError('invalid approved intent')
  const approvedPayloadJson = canonicalCloudJobAdamJson(approvedJob)
  const approvedPayloadDigest = canonicalCloudJobAdamSha256(approvedJob)
  if (request.requestFingerprint !== approvedPayloadDigest) throw new TypeError('invalid approved intent')
  return {
    request,
    requestJson: canonicalCloudJobAdamJson(request),
    requestDigest: canonicalCloudJobAdamSha256(request),
    approvedPayloadJson,
    approvedPayloadDigest
  }
}
