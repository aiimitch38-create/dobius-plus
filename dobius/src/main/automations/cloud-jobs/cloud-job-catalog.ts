import { createHash, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { realpathSync, statSync } from 'node:fs'
import {
  CloudId,
  CloudJob,
  CloudJobInput,
  CloudJobState,
  CloudProject,
  type CloudRootAuthority,
  type CloudRootIdentity,
  type CloudJobEvent
} from '../../../shared/cloud-jobs'
import { cloudTransaction, exportCloudJobsDatabase, openCloudJobsDatabase } from './database'
import type SyncDatabase from '../../sqlite/sync-database'
import type { CloudJobAdamBindingResponse } from '../../../shared/cloud-job-adam-receipts'
import { recordCloudJobAdamBindingInTransaction } from './cloud-job-adam-outbox'
import { CloudJobAdamOutboxNow } from './cloud-job-adam-outbox-schema'
import { appendAdamReceiptForCloudEvent } from './cloud-job-adam-event-receipt'
import { findCloudJobAdamChild } from './cloud-job-adam-child-lookup'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const ROOT_AUTHORITY_MAX_AGE_MS = 90_000

export type CloudJobStoreOptions = {
  /** Device identity of this host; absent means every project requires authority proof. */
  localDeviceId?: string
  /** Server-owned adapter backed by authenticated enrollment; never supplied by RPC callers. */
  rootAuthority?: CloudRootAuthority
}

export class CloudJobCatalog {
  readonly db: SyncDatabase
  private readonly databaseFile: string
  private readonly projectAuthorityRevisions = new Map<string, number>()
  constructor(
    file: string,
    protected readonly now: () => number = Date.now,
    protected readonly options: CloudJobStoreOptions = {}
  ) {
    this.databaseFile = file === ':memory:' ? file : resolve(file)
    this.db = openCloudJobsDatabase(file)
  }
  close(): void {
    this.db.close()
  }

  /** Returns the same validated clock used by atomic job and binding writes. */
  currentTimeMs(): number {
    return CloudJobAdamOutboxNow.parse(this.now())
  }

  async exportBackup(destination: string): Promise<number> {
    return exportCloudJobsDatabase(this.databaseFile, destination)
  }

  registerProject(project: CloudProject): void {
    CloudProject.parse(project)
    CloudId.parse(project.id)
    CloudId.parse(project.deviceId)
    project.recipes.forEach((id) => CloudId.parse(id))
    if (
      !project.recipes.length ||
      !['linux', 'macos', 'windows', 'portable'].includes(project.capability)
    ) {
      throw new Error('Project must have a capability and permitted recipes.')
    }
    const root = this.trustedRoot(project)
    if (!root) {
      throw new Error('Project root is not verified by local storage or fresh enrollment.')
    }
    this.db
      .prepare(
        'INSERT INTO cloud_projects VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET document=excluded.document'
      )
      .run(project.id, JSON.stringify({ ...project, root }))
    this.projectAuthorityRevisions.set(
      project.id,
      (this.projectAuthorityRevisions.get(project.id) ?? 0) + 1
    )
  }

  projectAuthorityRevision(projectId: string): number {
    return this.projectAuthorityRevisions.get(projectId) ?? 0
  }

  protected projectRootStillTrusted(project: CloudProject): boolean {
    const root = this.trustedRoot(project, project.root)
    return root === project.root
  }

  private trustedRoot(project: CloudProject, expectedRoot?: string): string | null {
    if (this.options.localDeviceId && project.deviceId === this.options.localDeviceId) {
      try {
        const root = realpathSync(project.root)
        if (root === resolve(project.root) && statSync(root).isDirectory()) {
          return !expectedRoot || expectedRoot === root ? root : null
        }
      } catch {
        return null
      }
      return null
    }

    try {
      const identity = this.options.rootAuthority?.getFreshRoot({
        projectId: project.id,
        deviceId: project.deviceId
      })
      if (!identity || !this.isFreshExactIdentity(identity, project)) {
        return null
      }
      return !expectedRoot || expectedRoot === identity.root ? identity.root : null
    } catch {
      return null
    }
  }

  private isFreshExactIdentity(identity: CloudRootIdentity, project: CloudProject): boolean {
    const now = this.now()
    return (
      identity.projectId === project.id &&
      identity.deviceId === project.deviceId &&
      typeof identity.root === 'string' &&
      identity.root.length > 0 &&
      identity.root.length <= 4096 &&
      Number.isSafeInteger(identity.issuedAt) &&
      Number.isSafeInteger(identity.expiresAt) &&
      identity.issuedAt <= now &&
      now - identity.issuedAt <= ROOT_AUTHORITY_MAX_AGE_MS &&
      identity.expiresAt > now
    )
  }

  project(id: string): CloudProject {
    const row = this.db.prepare('SELECT document FROM cloud_projects WHERE id=?').get(id)
    if (!row) {
      throw new Error('Project is not registered on this service.')
    }
    return CloudProject.parse(JSON.parse(String(row.document)))
  }

  setDispatchEnabled(enabled: boolean): void {
    this.db
      .prepare("UPDATE cloud_settings SET value=? WHERE key='dispatch_enabled'")
      .run(String(enabled))
  }
  isDispatchEnabled(): boolean {
    return (
      this.db.prepare("SELECT value FROM cloud_settings WHERE key='dispatch_enabled'").get()
        ?.value === 'true'
    )
  }

  get(id: string): CloudJob {
    const row = this.db.prepare('SELECT document FROM cloud_jobs WHERE id=?').get(id)
    if (!row) {
      throw new Error('Job does not exist.')
    }
    return CloudJob.parse(JSON.parse(String(row.document)))
  }

  list(limit = 200): CloudJob[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new Error('Invalid job limit.')
    }
    return this.db
      .prepare('SELECT document FROM cloud_jobs ORDER BY created_at DESC, id LIMIT ?')
      .all(limit)
      .map((row) => CloudJob.parse(JSON.parse(String(row.document))))
  }

  events(after = 0, limit = 200): CloudJobEvent[] {
    if (
      !Number.isSafeInteger(after) ||
      after < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 1000
    ) {
      throw new Error('Invalid event cursor or limit.')
    }
    return this.db
      .prepare('SELECT * FROM cloud_events WHERE sequence>? ORDER BY sequence LIMIT ?')
      .all(after, limit)
      .map((row) => ({
        sequence: Number(row.sequence),
        jobId: String(row.job_id),
        version: Number(row.version),
        state: CloudJobState.parse(row.state),
        at: Number(row.at),
        reason: String(row.reason)
      }))
  }

  submit(raw: CloudJobInput, creator: string): CloudJob {
    return this.submitWithBinding(raw, creator)
  }

  /** Trusted main-only caller must consume the authenticated ADAM grant before invoking. */
  submitAdamBound(
    raw: CloudJobInput,
    creator: string,
    binding: CloudJobAdamBindingResponse
  ): CloudJob {
    return this.submitWithBinding(raw, creator, binding)
  }

  /** Reads an exact previously committed ADAM-bound child after a lost acknowledgement. */
  findAdamBoundChild(
    approvedInput: CloudJobInput,
    consumedBinding: CloudJobAdamBindingResponse,
    creatorId?: string
  ): CloudJob | null {
    return findCloudJobAdamChild(this.db, approvedInput, consumedBinding, creatorId)
  }

  private submitWithBinding(
    raw: CloudJobInput,
    creator: string,
    binding?: CloudJobAdamBindingResponse
  ): CloudJob {
    const input = CloudJobInput.parse(raw)
    CloudId.parse(creator)
    input.dependencies = [...new Set(input.dependencies)].sort()
    const fingerprint = hash(JSON.stringify(input))
    return cloudTransaction(this.db, () => {
      const existing = this.db
        .prepare('SELECT id, fingerprint FROM cloud_jobs WHERE creator=? AND request_key=?')
        .get(creator, input.requestKey)
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          throw new Error('Request key was already used for different work.')
        }
        if (binding) {
          if (
            !this.db
              .prepare('SELECT job_id FROM cloud_job_adam_bindings WHERE job_id=?')
              .get(existing.id)
          ) {
            throw new Error('An existing unbound job cannot acquire a parent after submission.')
          }
          recordCloudJobAdamBindingInTransaction(this.db, {
            jobId: String(existing.id),
            bindingResponse: binding,
            nowMs: this.now()
          })
        }
        return this.get(String(existing.id))
      }
      const project = this.project(input.projectId)
      if (project.deviceId !== input.targetDeviceId || !project.recipes.includes(input.recipeId)) {
        throw new Error('Selected target or recipe is not registered for this project.')
      }
      input.dependencies.forEach((id) => this.get(id))
      const at = this.now()
      const job: CloudJob = {
        ...input,
        id: randomUUID(),
        createdBy: creator,
        state: 'queued',
        version: 1,
        createdAt: at,
        updatedAt: at,
        attemptCount: 0,
        waitingReason: null,
        evidence: [],
        outcome: null
      }
      this.db
        .prepare('INSERT INTO cloud_jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(
          job.id,
          creator,
          input.requestKey,
          fingerprint,
          job.state,
          job.targetDeviceId,
          at,
          JSON.stringify(job)
        )
      if (binding) {
        recordCloudJobAdamBindingInTransaction(this.db, {
          jobId: job.id,
          bindingResponse: binding,
          nowMs: at
        })
      }
      this.event(job, 'Submitted')
      return job
    })
  }

  protected event(job: CloudJob, reason: string): void {
    const inserted = this.db
      .prepare(
        'INSERT INTO cloud_events(job_id, version, state, at, reason) VALUES (?, ?, ?, ?, ?)'
      )
      .run(job.id, job.version, job.state, job.updatedAt, reason)
    appendAdamReceiptForCloudEvent(
      this.db,
      job,
      reason,
      Number(inserted.lastInsertRowid),
      this.now()
    )
  }
  protected save(job: CloudJob, patch: Partial<CloudJob>, reason: string): CloudJob {
    const next = CloudJob.parse({
      ...job,
      ...patch,
      version: job.version + 1,
      updatedAt: this.now()
    })
    this.db
      .prepare('UPDATE cloud_jobs SET state=?, document=? WHERE id=?')
      .run(next.state, JSON.stringify(next), next.id)
    this.event(next, reason)
    return next
  }
}
