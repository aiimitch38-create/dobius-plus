import { z } from 'zod'

export const CloudId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/)
export const CloudJobState = z.enum([
  'queued',
  'waiting_for_worker',
  'running',
  'needs_review',
  'completed',
  'failed',
  'cancelled',
  'interrupted'
])
export const CloudJobInput = z
  .object({
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
  })
  .strict()

export type CloudJobInput = z.infer<typeof CloudJobInput>
export const CloudJob = CloudJobInput.extend({
  id: CloudId,
  createdBy: CloudId,
  state: CloudJobState,
  version: z.number().int().positive(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  attemptCount: z.number().int().nonnegative(),
  waitingReason: z.string().max(300).nullable(),
  evidence: z.array(z.string().max(512)).max(50),
  outcome: z.string().max(1000).nullable()
})
export type CloudJob = z.infer<typeof CloudJob>

export const CloudProject = z
  .object({
    id: CloudId,
    deviceId: CloudId,
    root: z.string().min(1).max(4096),
    recipes: z.array(CloudId).min(1).max(100),
    capability: z.enum(['linux', 'macos', 'windows', 'portable'])
  })
  .strict()
export type CloudProject = z.infer<typeof CloudProject>

export type CloudRootIdentity = {
  projectId: string
  deviceId: string
  /** Canonical path asserted by a fresh authenticated enrollment, not by an RPC caller. */
  root: string
  issuedAt: number
  expiresAt: number
}

export type CloudRootAuthority = {
  /** Implementations must return only identities verified through authenticated enrollment. */
  getFreshRoot(identity: { projectId: string; deviceId: string }): CloudRootIdentity | null
}

export type CloudWorker = {
  id: string
  deviceId: string
  capabilities: string[]
  freeBytes: number
  /** Authenticated non-queue reservations only; persisted queue claims are added by the store. */
  externalReservedBytes: number
  safetyBytes: number
  sampledAt: number
}

export type CloudClaim = {
  job: CloudJob
  attemptId: string
  leaseToken: string
  leaseExpiresAt: number
}

export type CloudJobEvent = {
  sequence: number
  jobId: string
  version: number
  state: CloudJob['state']
  at: number
  reason: string
}
