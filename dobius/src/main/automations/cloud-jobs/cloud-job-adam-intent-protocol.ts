import { z } from 'zod'
import { CloudJobAdamBindingIdentity } from '../../../shared/cloud-job-adam-receipts'
import {
  AdamIntentEnvelope,
  MAX_ADAM_INTENT_SEALED_CHARS
} from '../../../shared/cloud-job-adam-intent-wire'

export { AdamIntentEnvelope }

export const MAX_SEALED_CHARS = MAX_ADAM_INTENT_SEALED_CHARS
export const MAX_PURPOSE_BYTES = 64 * 1024
export const SEALED_PREFIX = 'sealed:dobius-adam-intent:v1:'
export const PURPOSE = 'dobius.adam-capability-intent'

export const PurposeEnvelope = z
  .object({
    purpose: z.literal(PURPOSE),
    schemaVersion: z.literal(1),
    intentId: z.string().uuid(),
    identity: CloudJobAdamBindingIdentity,
    capability: z.string().min(32).max(512)
  })
  .strict()

export const SealedIntentRequest = z
  .object({
    schemaVersion: z.literal(1),
    intentId: z.string().uuid(),
    identity: CloudJobAdamBindingIdentity,
    sealedEnvelope: z
      .string()
      .min(SEALED_PREFIX.length + 4)
      .max(MAX_SEALED_CHARS)
  })
  .strict()
