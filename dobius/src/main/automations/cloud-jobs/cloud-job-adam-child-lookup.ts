import { createHash } from 'node:crypto'
import type SyncDatabase from '../../sqlite/sync-database'
import {
  CloudJobAdamBindingGrant,
  CloudJobAdamBindingResponse,
  canonicalCloudJobAdamJson,
  canonicalCloudJobAdamSha256,
  type CloudJobAdamBindingResponse as BindingResponse
} from '../../../shared/cloud-job-adam-receipts'
import { CloudJob, CloudJobInput, type CloudJobInput as JobInput } from '../../../shared/cloud-jobs'

const ADAM_PARENT_PLANNER = 'adam-parent-planner'

/** Reads the exact previously committed child for one authenticated parent binding. */
export function findCloudJobAdamChild(
  db: SyncDatabase,
  approvedInput: JobInput,
  consumedBinding: BindingResponse,
  creatorId = ADAM_PARENT_PLANNER
): CloudJob | null {
  const input = normalizeInput(CloudJobInput.parse(approvedInput))
  const expectedBinding = CloudJobAdamBindingResponse.parse(consumedBinding)
  const binding = expectedBinding.binding
  const fingerprint = canonicalCloudJobAdamSha256(input)
  if (
    binding.projectId !== input.projectId ||
    binding.requestFingerprint !== fingerprint ||
    expectedBinding.bindingDigest !== canonicalCloudJobAdamSha256(binding)
  ) {
    throw lookupMismatch()
  }

  // Scope request-key matching to the planner, but find any owner of this exact binding globally.
  const rows = db
    .prepare(
      `SELECT j.id, j.creator, j.request_key, j.fingerprint, j.document, b.binding_id AS linked_binding_id
       FROM cloud_jobs j LEFT JOIN cloud_job_adam_bindings b ON b.job_id=j.id
       WHERE (j.creator=? AND j.request_key=?) OR b.binding_id=? LIMIT 2`
    )
    .all(creatorId, input.requestKey, binding.bindingId)
  if (rows.length === 0) {
    return null
  }
  if (rows.length !== 1) {
    throw lookupMismatch()
  }

  const row = rows[0]!
  if (
    row.creator !== creatorId ||
    row.request_key !== input.requestKey ||
    row.linked_binding_id !== binding.bindingId
  ) {
    throw lookupMismatch()
  }

  let job: CloudJob
  try {
    job = CloudJob.parse(JSON.parse(String(row.document)))
  } catch {
    throw lookupMismatch()
  }
  if (
    job.id !== row.id ||
    job.createdBy !== creatorId ||
    job.requestKey !== input.requestKey ||
    !sameInput(inputFromJob(job), input) ||
    row.fingerprint !== storeFingerprint(input)
  ) {
    throw lookupMismatch()
  }

  const storedBinding = readStoredBinding(db, job.id)
  if (
    storedBinding.binding.projectId !== job.projectId ||
    storedBinding.binding.requestFingerprint !== fingerprint ||
    canonicalCloudJobAdamJson(storedBinding) !== canonicalCloudJobAdamJson(expectedBinding)
  ) {
    throw lookupMismatch()
  }
  return job
}

/** Read-only recovery lookup from an unsealed grant; never consumes or writes it. */
export function findCloudJobAdamChildByGrant(
  db: SyncDatabase,
  approvedInput: JobInput,
  rawGrant: unknown,
  creatorId = ADAM_PARENT_PLANNER
): CloudJob | null {
  const input = normalizeInput(CloudJobInput.parse(approvedInput))
  const grant = CloudJobAdamBindingGrant.parse(rawGrant)
  const { capability: _capability, ...identity } = grant
  if (
    identity.projectId !== input.projectId ||
    identity.requestFingerprint !== canonicalCloudJobAdamSha256(input)
  ) {
    throw lookupMismatch()
  }

  const bindingLink = db
    .prepare('SELECT job_id FROM cloud_job_adam_bindings WHERE binding_id=?')
    .get(identity.bindingId)
  if (!bindingLink) {
    const requestJob = db
      .prepare('SELECT id FROM cloud_jobs WHERE creator=? AND request_key=? LIMIT 1')
      .get(creatorId, input.requestKey)
    if (requestJob) {
      throw lookupMismatch()
    }
    return null
  }

  const storedBinding = readStoredBinding(db, String(bindingLink.job_id))
  if (canonicalCloudJobAdamJson(storedBinding.binding) !== canonicalCloudJobAdamJson(identity)) {
    throw lookupMismatch()
  }
  const child = findCloudJobAdamChild(db, input, storedBinding, creatorId)
  if (!child) {
    throw lookupMismatch()
  }
  return child
}

/** Main-only read wrapper runs the authority fence immediately before this synchronous query. */
export function findCloudJobAdamChildByVerifiedGrant(
  db: SyncDatabase,
  approvedInput: JobInput,
  rawGrant: unknown,
  assertAuthorityCurrent: () => void
): CloudJob | null {
  const input = CloudJobInput.parse(approvedInput)
  const grant = CloudJobAdamBindingGrant.parse(rawGrant)
  assertAuthorityCurrent()
  return findCloudJobAdamChildByGrant(db, input, grant, 'adam')
}

function readStoredBinding(db: SyncDatabase, jobId: string): BindingResponse {
  const row = db.prepare('SELECT * FROM cloud_job_adam_bindings WHERE job_id=?').get(jobId)
  if (!row) {
    throw lookupMismatch()
  }
  try {
    const binding = {
      schemaVersion: 1,
      bindingId: row.binding_id,
      adamInstanceId: row.adam_instance_id,
      parentObjectiveId: row.parent_objective_id,
      parentObjectiveVersion: Number(row.parent_objective_version),
      projectId: row.project_id,
      contextDigest: row.context_digest,
      requestFingerprint: row.request_fingerprint,
      expiresAtMs: Number(row.expires_at_ms)
    }
    const response = CloudJobAdamBindingResponse.parse({
      schemaVersion: 1,
      consumed: true,
      binding,
      boundAtMs: Number(row.bound_at_ms),
      bindingDigest: row.binding_digest
    })
    if (response.bindingDigest !== canonicalCloudJobAdamSha256(response.binding)) {
      throw lookupMismatch()
    }
    return response
  } catch {
    throw lookupMismatch()
  }
}

function inputFromJob(job: CloudJob): JobInput {
  return CloudJobInput.parse({
    requestKey: job.requestKey,
    taskId: job.taskId,
    projectId: job.projectId,
    workspaceId: job.workspaceId,
    targetDeviceId: job.targetDeviceId,
    recipeId: job.recipeId,
    title: job.title,
    sourceRevision: job.sourceRevision,
    estimatedBytes: job.estimatedBytes,
    dependencies: job.dependencies
  })
}

function normalizeInput(input: JobInput): JobInput {
  return { ...input, dependencies: [...new Set(input.dependencies)].sort() }
}

function sameInput(left: JobInput, right: JobInput): boolean {
  return canonicalCloudJobAdamJson(left) === canonicalCloudJobAdamJson(right)
}

function storeFingerprint(input: JobInput): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

function lookupMismatch(): Error {
  return new Error('An existing child does not match the approved request and parent binding.')
}
