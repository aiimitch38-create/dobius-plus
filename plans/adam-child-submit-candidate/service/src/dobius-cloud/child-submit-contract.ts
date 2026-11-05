import { z } from 'zod'
import {
  CloudJobAdamBindingGrant,
  canonicalCloudJobAdamSha256,
  type CloudJobAdamBindingGrant as BindingGrant
} from './receipt-contract.js'

const CloudId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/)
export const AdamCloudJobInputSchema = z.object({
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

export const AdamSubmissionProofSchema = z.object({
  ready: z.literal(true),
  submissionEnabled: z.literal(true),
  localRuntime: z.literal(true),
  runtimeId: z.string().min(1).max(200),
  runtimeUserDataPath: z.string().min(1).max(4096),
  projectId: CloudId,
  bindingId: z.string().uuid(),
  requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAtMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
}).strict()

export type AdamCloudJobInput = z.infer<typeof AdamCloudJobInputSchema>
export type AdamCloudSubmissionProof = z.infer<typeof AdamSubmissionProofSchema>
export type AdamCloudChildRequest = { input: AdamCloudJobInput; grant: BindingGrant }
export type AdamCloudChild = Pick<
  AdamCloudJobInput,
  'projectId' | 'requestKey' | 'sourceRevision' | 'targetDeviceId' | 'recipeId'
> & { id: string; state: string }
export type AdamCloudChildSubmitFailure =
  | 'not-ready' | 'invalid-request' | 'deadline' | 'output-limit'
  | 'spawn-failed' | 'child-failed' | 'invalid-response'

export interface AdamCloudSubmissionAuthority {
  acquire(request: AdamCloudChildRequest, signal: AbortSignal): Promise<unknown | null>
  /** Must synchronously verify that the acquired proof is still current. */
  isCurrent(proof: AdamCloudSubmissionProof): boolean
}

export class AdamCloudChildSubmitError extends Error {
  constructor(readonly code: AdamCloudChildSubmitFailure) {
    super(ERROR_MESSAGES[code])
    this.name = 'AdamCloudChildSubmitError'
  }
}

const ERROR_MESSAGES: Record<AdamCloudChildSubmitFailure, string> = {
  'not-ready': 'ADAM child submission authority is unavailable.',
  'invalid-request': 'ADAM child submission request is invalid.',
  deadline: 'ADAM child submission deadline expired.',
  'output-limit': 'Dobius CLI response exceeded the allowed size.',
  'spawn-failed': 'Dobius CLI could not be started.',
  'child-failed': 'Dobius CLI refused the child submission.',
  'invalid-response': 'Dobius CLI returned an invalid child response.'
}

export function parseAdamCloudChildRequest(raw: unknown): AdamCloudChildRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalidRequest()
  const record = raw as Record<string, unknown>
  const input = AdamCloudJobInputSchema.safeParse(record.input)
  const grant = CloudJobAdamBindingGrant.safeParse(record.grant)
  if (Object.keys(record).some((key) => key !== 'input' && key !== 'grant') || !input.success || !grant.success) {
    throw invalidRequest()
  }
  // Match CloudJobCatalog.submitWithBinding: persisted dependencies are unique and sorted.
  const normalizedInput = { ...input.data, dependencies: [...new Set(input.data.dependencies)].sort() }
  if (normalizedInput.projectId !== grant.data.projectId || canonicalCloudJobAdamSha256(normalizedInput) !== grant.data.requestFingerprint) {
    throw invalidRequest()
  }
  return { input: normalizedInput, grant: grant.data }
}

function invalidRequest(): AdamCloudChildSubmitError {
  return new AdamCloudChildSubmitError('invalid-request')
}
