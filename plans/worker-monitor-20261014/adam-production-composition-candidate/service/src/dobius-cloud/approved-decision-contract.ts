import { z } from 'zod'
import { canonicalCloudJobAdamJson, CLOUD_JOB_ADAM_MAX_CANONICAL_BYTES } from './receipt-contract.js'
import { parseCanonicalApprovedJobPayload } from './approved-job-payload.js'

const CloudId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/)
const Sha256 = z.string().regex(/^[a-f0-9]{64}$/)
const SafeTime = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

export const TrustedApprovedCloudDecision = z.object({
  schemaVersion: z.literal(1),
  decisionId: z.string().uuid(),
  actorId: CloudId,
  actorSourceId: CloudId,
  sourceEventId: CloudId,
  actorEvidenceDigest: Sha256,
  sourceBinding: Sha256,
  authorityGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  parentObjectiveId: CloudId,
  parentObjectiveVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  projectId: CloudId,
  contextDigest: Sha256,
  expiresAtMs: SafeTime,
  approvedPayloadJson: z.string().max(CLOUD_JOB_ADAM_MAX_CANONICAL_BYTES)
}).strict()

export type TrustedApprovedCloudDecision = z.infer<typeof TrustedApprovedCloudDecision>

/** This provider is a trusted bootstrap dependency, never a request-body adapter. */
export interface ApprovedCloudDecisionAuthority {
  resolveExactDecisionJson(decisionId: string): Promise<unknown | null>
  /** Synchronous revocation/generation fence checked after each external await. */
  isCurrent(decision: TrustedApprovedCloudDecision): boolean
}

export function parseTrustedApprovedCloudDecision(raw: unknown, requestedDecisionId: string): TrustedApprovedCloudDecision {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > 2 * CLOUD_JOB_ADAM_MAX_CANONICAL_BYTES ||
      Buffer.from(raw, 'utf8').toString('utf8') !== raw) throw new TypeError('invalid approved decision')
  let decoded: unknown
  try { decoded = JSON.parse(raw) } catch { throw new TypeError('invalid approved decision') }
  const parsed = TrustedApprovedCloudDecision.safeParse(decoded)
  if (!parsed.success || parsed.data.decisionId !== requestedDecisionId ||
      canonicalCloudJobAdamJson(parsed.data) !== raw) throw new TypeError('invalid approved decision')
  const payload = parseCanonicalApprovedJobPayload(parsed.data.approvedPayloadJson)
  if (payload.projectId !== parsed.data.projectId) throw new TypeError('invalid approved decision')
  return parsed.data
}

export function actorSourceEvidence(decision: TrustedApprovedCloudDecision): string {
  return canonicalCloudJobAdamJson({
    actorId: decision.actorId,
    actorSourceId: decision.actorSourceId,
    sourceEventId: decision.sourceEventId,
    actorEvidenceDigest: decision.actorEvidenceDigest,
    sourceBinding: decision.sourceBinding,
    authorityGeneration: decision.authorityGeneration
  })
}
