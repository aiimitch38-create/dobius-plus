import { z } from 'zod'
import { CloudJob, CloudJobInput } from './cloud-jobs'
import { CloudJobAdamBindingIdentity } from './cloud-job-adam-receipts'
import type { CloudJobAdamBindingGrant } from './cloud-job-adam-receipts'

export const MAX_ADAM_INTENT_SEALED_CHARS = 64 * 1024

export const AdamIntentEnvelope = z
  .object({
    schemaVersion: z.literal(1),
    intentId: z.string().uuid(),
    identity: CloudJobAdamBindingIdentity,
    capability: z.string().min(32).max(512)
  })
  .strict()

const RuntimeId = z.string().uuid()
const Credential = z.string().regex(/^[A-Za-z0-9_-]{43}$/)

export const AdamSealApprovedIntentRequest = z
  .object({
    schemaVersion: z.literal(1),
    audienceRuntimeId: RuntimeId,
    credential: Credential,
    envelope: AdamIntentEnvelope
  })
  .strict()

export const AdamSealApprovedIntentResponse = z
  .object({
    schemaVersion: z.literal(1),
    audienceRuntimeId: RuntimeId,
    intentId: z.string().uuid(),
    identity: CloudJobAdamBindingIdentity,
    sealedEnvelope: z.string().min(1).max(MAX_ADAM_INTENT_SEALED_CHARS)
  })
  .strict()

const CanonicalApprovedJob = CloudJobInput.superRefine((job, context) => {
  const sorted = [...new Set(job.dependencies)].sort()
  if (
    sorted.length !== job.dependencies.length ||
    sorted.some((value, index) => value !== job.dependencies[index])
  ) {
    context.addIssue({ code: 'custom', message: 'Dependencies must be unique and sorted.' })
  }
})

export const AdamSubmitApprovedIntentRequest = z
  .object({
    schemaVersion: z.literal(1),
    audienceRuntimeId: RuntimeId,
    credential: Credential,
    intentId: z.string().uuid(),
    identity: CloudJobAdamBindingIdentity,
    sealedEnvelope: z.string().min(1).max(MAX_ADAM_INTENT_SEALED_CHARS),
    approvedJob: CanonicalApprovedJob
  })
  .strict()

export const AdamSubmitApprovedIntentResponse = z
  .object({
    schemaVersion: z.literal(1),
    audienceRuntimeId: RuntimeId,
    intentId: z.string().uuid(),
    identity: CloudJobAdamBindingIdentity,
    job: CloudJob
  })
  .strict()

// Lookup uses the same immutable sealed packet, but returns only an existing child.
export const AdamLookupApprovedIntentRequest = AdamSubmitApprovedIntentRequest

export const AdamLookupApprovedIntentResponse = z
  .object({
    schemaVersion: z.literal(1),
    audienceRuntimeId: RuntimeId,
    intentId: z.string().uuid(),
    identity: CloudJobAdamBindingIdentity,
    job: CloudJob.nullable()
  })
  .strict()

export type AdamSealApprovedIntentRequest = z.infer<typeof AdamSealApprovedIntentRequest>
export type AdamSubmitApprovedIntentRequest = z.infer<typeof AdamSubmitApprovedIntentRequest>

export function detachAdamIdentity(identity: z.infer<typeof CloudJobAdamBindingIdentity>) {
  return Object.freeze({ ...identity })
}

export function sameAdamBindingIdentity(
  left: z.infer<typeof CloudJobAdamBindingIdentity>,
  right: z.infer<typeof CloudJobAdamBindingIdentity>
): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.bindingId === right.bindingId &&
    left.adamInstanceId === right.adamInstanceId &&
    left.parentObjectiveId === right.parentObjectiveId &&
    left.parentObjectiveVersion === right.parentObjectiveVersion &&
    left.projectId === right.projectId &&
    left.contextDigest === right.contextDigest &&
    left.requestFingerprint === right.requestFingerprint &&
    left.expiresAtMs === right.expiresAtMs
  )
}

export function sameAdamGrantIdentity(
  grant: z.infer<typeof CloudJobAdamBindingGrant>,
  identity: z.infer<typeof CloudJobAdamBindingIdentity>
): boolean {
  const { capability: _capability, ...actualIdentity } = grant
  return sameAdamBindingIdentity(actualIdentity, identity)
}
