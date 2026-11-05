import { z } from 'zod'
import { CloudJobAdamBindingIdentity } from './receipt-contract.js'

const CloudId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/)
const Sha256 = z.string().regex(/^[a-f0-9]{64}$/)

export const AdamCloudIntentRequest = z.object({
  intentId: z.string().uuid(),
  parentObjectiveId: CloudId,
  parentObjectiveVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  projectId: CloudId,
  contextDigest: Sha256,
  requestFingerprint: Sha256,
  ttlMs: z.number().int().min(1000).max(300_000)
}).strict()
export type AdamCloudIntentRequest = z.infer<typeof AdamCloudIntentRequest>

export const AdamCloudIntentEnvelope = z.object({
  schemaVersion: z.literal(1),
  intentId: z.string().uuid(),
  identity: CloudJobAdamBindingIdentity,
  capability: z.string().min(32).max(512)
}).strict()
export type AdamCloudIntentEnvelope = z.infer<typeof AdamCloudIntentEnvelope>

export const AdamCloudSealedEnvelope = z.string().min(1).max(64 * 1024)

export type AdamCloudIntentResult =
  | { status: 'issued'; grant: import('./receipt-contract.js').CloudJobAdamBindingGrant }
  | { status: 'existing'; intentId: string; bindingId: string; expiresAtMs: number }
  | { status: 'published'; intentId: string; bindingId: string; expiresAtMs: number }

export type AdamCloudIntentSealer = (envelope: AdamCloudIntentEnvelope) => Promise<unknown>
