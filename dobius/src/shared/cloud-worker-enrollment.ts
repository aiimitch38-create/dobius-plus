import { z } from 'zod'
import { CloudId } from './cloud-jobs'
import { WorkerCaps, WorkerId, WorkerStartPermit } from './workstation-worker'

const Capability = z.enum(['linux', 'macos', 'windows', 'portable'])
export const DEFAULT_MINIMUM_WORKING_BYTES = 20 * 1024 * 1024 * 1024

export const CloudWorkerAssignment = z
  .object({
    projectId: CloudId,
    rootId: WorkerId,
    worktreeId: WorkerId,
    recipeId: WorkerId,
    profileId: WorkerId,
    minimumWorkingBytes: z
      .number()
      .int()
      .nonnegative()
      .safe()
      .default(DEFAULT_MINIMUM_WORKING_BYTES),
    caps: WorkerCaps
  })
  .strict()
export type CloudWorkerAssignment = z.infer<typeof CloudWorkerAssignment>

export const CloudWorkerEnrollment = z
  .object({
    workerId: WorkerId,
    deviceId: WorkerId,
    capabilities: z.array(Capability).min(1).max(4),
    assignments: z.array(CloudWorkerAssignment).min(1).max(128)
  })
  .strict()
  .superRefine((enrollment, context) => {
    const keys = enrollment.assignments.map((assignment) =>
      [assignment.projectId, assignment.recipeId].join('\0')
    )
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: 'custom',
        message: 'Worker project/recipe assignments must be unique.'
      })
    }
  })
export type CloudWorkerEnrollment = z.infer<typeof CloudWorkerEnrollment>

export const CloudWorkerCapacitySample = z
  .object({
    freeBytes: z.number().int().nonnegative().safe(),
    // Must exclude persisted queue reservations, which are read transactionally at claim time.
    externalReservedBytes: z.number().int().nonnegative().safe(),
    safetyBytes: z.number().int().nonnegative().safe(),
    sampledAt: z.number().int().nonnegative().safe()
  })
  .strict()
export type CloudWorkerCapacitySample = z.infer<typeof CloudWorkerCapacitySample>

export function availableCloudWorkerBytes(
  sample: Pick<CloudWorkerCapacitySample, 'freeBytes' | 'externalReservedBytes' | 'safetyBytes'>,
  persistedQueueReservedBytes: number
): number | null {
  const values = [
    sample.freeBytes,
    sample.externalReservedBytes,
    sample.safetyBytes,
    persistedQueueReservedBytes
  ]
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    return null
  }
  const commitments =
    sample.externalReservedBytes + persistedQueueReservedBytes + sample.safetyBytes
  if (!Number.isSafeInteger(commitments)) {
    return null
  }
  return sample.freeBytes - commitments
}

export const CloudWorkerStartBinding = z
  .object({
    attemptId: WorkerId,
    workerId: WorkerId,
    deviceId: WorkerId,
    profileId: WorkerId,
    rootId: WorkerId,
    worktreeId: WorkerId,
    recipeId: WorkerId,
    sourceRevision: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
    caps: WorkerCaps
  })
  .strict()
export type CloudWorkerStartBinding = z.infer<typeof CloudWorkerStartBinding>

export const CloudWorkerProcessIdentity = z
  .object({
    pid: z.number().int().positive().safe(),
    processStart: z.string().min(1).max(256),
    processGroupId: z.number().int().positive().safe(),
    bootId: z.string().min(1).max(256),
    incarnation: WorkerId
  })
  .strict()
export type CloudWorkerProcessIdentity = z.infer<typeof CloudWorkerProcessIdentity>

export const CloudWorkerStartRecord = z
  .object({
    permit: WorkerStartPermit,
    projectId: CloudId,
    jobId: CloudId,
    bindingSha256: z.string().regex(/^[a-f0-9]{64}$/),
    identity: CloudWorkerProcessIdentity,
    startedAt: z.number().int().positive().safe()
  })
  .strict()
export type CloudWorkerStartRecord = z.infer<typeof CloudWorkerStartRecord>

export const CloudWorkerStopProof = z
  .object({
    attemptId: WorkerId,
    workerId: WorkerId,
    processGroupId: z.number().int().positive().safe(),
    observedAt: z.number().int().positive().safe(),
    descendantsAbsent: z.literal(true),
    containment: z.literal('posix-process-group'),
    identity: CloudWorkerProcessIdentity,
    bindingSha256: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .strict()
export type CloudWorkerStopProof = z.infer<typeof CloudWorkerStopProof>
