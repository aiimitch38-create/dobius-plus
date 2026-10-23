import { z } from 'zod'

const SafeIdentifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
export const WorkerId = SafeIdentifier
export const WorkerAttemptId = SafeIdentifier
export const WorkerRevision = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
export const WorkerLeaseReceipt = z
  .object({
    attemptId: WorkerAttemptId,
    workerId: WorkerId,
    token: z.string().min(32).max(512),
    expiresAt: z.number().int().positive()
  })
  .strict()

export const WorkerCaps = z
  .object({
    wallTimeMs: z
      .number()
      .int()
      .positive()
      .max(6 * 60 * 60 * 1000),
    outputBytes: z
      .number()
      .int()
      .positive()
      .max(64 * 1024 * 1024),
    artifactBytes: z
      .number()
      .int()
      .nonnegative()
      .max(256 * 1024 * 1024),
    memoryBytes: z
      .number()
      .int()
      .positive()
      .max(64 * 1024 * 1024 * 1024),
    cpuCount: z.number().int().positive().max(64)
  })
  .strict()
export type WorkerCaps = z.infer<typeof WorkerCaps>

export const WorkerJob = z
  .object({
    id: WorkerAttemptId,
    attemptId: WorkerAttemptId,
    deviceId: WorkerId,
    recipeId: WorkerId,
    rootId: WorkerId,
    sourceRevision: WorkerRevision,
    profileId: WorkerId,
    worktreeId: WorkerId,
    caps: WorkerCaps
  })
  .strict()
export type WorkerJob = z.infer<typeof WorkerJob>

export type RegisteredRecipe = {
  id: string
  executable: string
  argv: readonly string[]
  maxCaps: WorkerCaps
  artifactPaths?: readonly string[]
  hermesProfileId?: string
}

export type EnrolledRoot = {
  id: string
  canonicalPath: string
  allowedRecipes: readonly string[]
  allowedWorktrees: readonly string[]
}

export type EnrolledWorktree = {
  id: string
  rootId: string
  canonicalPath: string
}

export type HermesProfileRegistration = {
  id: 'hermes-1' | 'hermes-2'
  home: string
  worktreeId: string
  allowedRoots: readonly string[]
  allowedRecipes: readonly string[]
  credentialRef: string
  authVerified: boolean
  runtimeVerified: boolean
}

export const HERMES_PROFILE_IDS = ['hermes-1', 'hermes-2'] as const

export type WorkerLease = z.infer<typeof WorkerLeaseReceipt>
export type WorkerClaim = {
  job: WorkerJob
  attemptId: string
  workerId: string
  token: string
  expiresAt: number
}
export const WorkerStartPermit = z
  .object({
    permitId: WorkerId,
    attemptId: WorkerAttemptId,
    workerId: WorkerId,
    deviceId: WorkerId,
    profileId: WorkerId,
    rootId: WorkerId,
    worktreeId: WorkerId,
    recipeId: WorkerId,
    sourceRevision: WorkerRevision,
    caps: WorkerCaps,
    expiresAt: z.number().int().positive()
  })
  .strict()
export type WorkerStartPermit = z.infer<typeof WorkerStartPermit>
export type WorkerStartBinding = Omit<WorkerStartPermit, 'permitId' | 'expiresAt'>
export type LeaseSealer = {
  seal(token: string): string
  unseal(sealedToken: string): string
}
export type QueuePort = {
  // Claim adapters must use authenticated external-reservation telemetry and add current queue
  // reservations from durable storage; an ambiguous total cannot safely infer overlap by time.
  claim(workerId: string): Promise<WorkerClaim | null>
  // Must validate the durable server lease and current per-device authority before issuing.
  authorizeStart(lease: WorkerLease, binding: WorkerStartBinding): Promise<WorkerStartPermit>
  acknowledgeStarted(
    lease: WorkerLease,
    identity: {
      pid: number
      processStart: string
      processGroupId: number
      bootId: string
      incarnation: string
    }
  ): Promise<void>
  reconcile(
    lease: WorkerLease,
    identity: {
      pid: number
      processStart: string
      processGroupId: number
      bootId: string
      incarnation: string
    }
  ): Promise<'owned' | 'stopping' | 'unknown'>
  heartbeat(
    lease: WorkerLease,
    progress: { outputBytes: number; logCursor: number }
  ): Promise<WorkerLease>
  settle(
    lease: WorkerLease,
    result: { succeeded: boolean; exitCode: number | null; evidence: string[] }
  ): Promise<void>
  acknowledgeStopped(lease: WorkerLease, receipt: StopReceipt): Promise<void>
}

export type StopReceipt = {
  attemptId: string
  workerId: string
  processGroupId: number
  observedAt: number
  descendantsAbsent: true
  containment: 'posix-process-group'
}
