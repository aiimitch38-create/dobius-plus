import {
  CloudId,
  type CloudJob,
  type CloudJobInput,
  type CloudProject
} from '../../shared/cloud-jobs'
import type { CloudJobStore } from './cloud-jobs/store'
import {
  createCloudJobAdamLookupReader,
  type CloudJobAdamLookupReader
} from './cloud-jobs/cloud-job-adam-lookup-authority'
import { randomUUID } from 'node:crypto'
import { CloudJobWorkerLifecycle } from './cloud-job-worker-lifecycle'
import { admitCloudJobSubmission } from './cloud-job-submit-admission'
import {
  JobSnapshotCursors,
  latestJobEventSequence,
  readJobSnapshotPage
} from './cloud-job-snapshot'
import type { CloudJobPrincipal, CloudJobServiceOptions } from './cloud-job-service-contract'
export type { CloudJobPrincipal, CloudJobServiceOptions } from './cloud-job-service-contract'

/** Authenticated API boundary; worker execution remains a separate enrolled adapter. */
export class CloudJobService {
  private currentStore: CloudJobStore | null = null
  private generation = randomUUID()
  private cursors = new JobSnapshotCursors()
  private workers: CloudJobWorkerLifecycle
  private closing = false
  constructor(private readonly options: CloudJobServiceOptions) {
    this.workers = new CloudJobWorkerLifecycle(options.createWorkerHost)
  }

  private get store(): CloudJobStore {
    if (this.closing || this.workers.closing) {
      throw new Error('Cloud jobs authority is shutting down.')
    }
    if (this.options.authorityAvailable?.() === false) {
      throw new Error('Cloud jobs authority is disabled or unavailable.')
    }
    if (!this.currentStore) {
      const store = this.options.openStore()
      try {
        this.workers.attach(store)
        this.currentStore = store
      } catch (error) {
        store.close()
        throw error
      }
    }
    return this.currentStore
  }

  close(): void {
    if (this.workers.attached) {
      throw new Error('Worker-backed cloud jobs must drain through shutdown before closing.')
    }
    this.resetStore()
  }

  async shutdown(
    timeoutMs = 5_000
  ): Promise<{ drained: boolean; dispatchPausePersisted: boolean }> {
    this.closing = true
    let dispatchPausePersisted = true
    try {
      this.currentStore?.setDispatchEnabled(false)
    } catch {
      // Database failure must not skip exact worker cancellation and bounded drain.
      dispatchPausePersisted = false
    }
    const drained = await this.workers.shutdown(timeoutMs)
    if (drained) {
      this.resetStore()
    }
    return { drained, dispatchPausePersisted }
  }

  private resetStore(): void {
    this.currentStore?.close()
    this.currentStore = null
    this.generation = randomUUID()
    this.cursors = new JobSnapshotCursors()
    this.workers = new CloudJobWorkerLifecycle(this.options.createWorkerHost)
  }

  private get executorReady(): boolean {
    return this.options.createWorkerHost
      ? this.workers.eligible && this.options.liveDispatchReady?.() !== false
      : this.options.liveDispatchReady?.() === true
  }

  status(): {
    configured: boolean
    generation: string
    dispatchEnabled: boolean
    liveDispatchReady: boolean
  } {
    if (this.closing || this.options.authorityAvailable?.() === false) {
      return {
        configured: false,
        generation: this.generation,
        dispatchEnabled: false,
        liveDispatchReady: false
      }
    }
    return {
      configured: true,
      generation: this.generation,
      dispatchEnabled: this.store.isDispatchEnabled(),
      liveDispatchReady: this.executorReady
    }
  }

  private administrator(principal: CloudJobPrincipal): void {
    CloudId.parse(principal.id)
    if (principal.kind !== 'local') {
      throw new Error('Cloud jobs require local administrative authority.')
    }
  }

  registerProject(principal: CloudJobPrincipal, project: CloudProject): void {
    this.administrator(principal)
    this.store.registerProject(project)
  }

  setDispatchEnabled(principal: CloudJobPrincipal, enabled: boolean): void {
    this.administrator(principal)
    // User intent alone cannot turn an unverified executor into an eligible worker.
    if (enabled) {
      void this.store
    }
    if (enabled && !this.executorReady) {
      throw new Error('Verified worker and dispatch prerequisites are not ready.')
    }
    this.store.setDispatchEnabled(enabled)
  }

  private async permitted(principal: CloudJobPrincipal, job: CloudJob): Promise<boolean> {
    CloudId.parse(principal.id)
    if (principal.kind === 'local') {
      return true
    }
    const project = this.store.project(job.projectId)
    const allowed = await this.options.canUseWorkspace(principal, job.workspaceId, project)
    return allowed && JSON.stringify(this.store.project(project.id)) === JSON.stringify(project)
  }

  async get(principal: CloudJobPrincipal, id: string): Promise<CloudJob> {
    const job = this.store.get(id)
    if (!(await this.permitted(principal, job))) {
      throw new Error('Cloud job access denied.')
    }
    return this.store.get(id)
  }

  async list(principal: CloudJobPrincipal, limit = 200): Promise<CloudJob[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new Error('Invalid job limit.')
    }
    const jobs: CloudJob[] = []
    for (const job of this.store.list(limit)) {
      if (await this.permitted(principal, job)) {
        void this.store
        jobs.push(job)
      }
    }
    void this.store
    return jobs
  }

  async events(principal: CloudJobPrincipal, after = 0, limit = 200) {
    CloudId.parse(principal.id)
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 200 ||
      !Number.isSafeInteger(after) ||
      after < 0
    ) {
      throw new Error('Invalid event limit.')
    }
    const latest = latestJobEventSequence(this.store.db)
    if (after > latest) {
      return { generation: this.generation, resetRequired: true, events: [], nextCursor: 0 }
    }
    const scanned = this.store.events(after, limit)
    const allowed = new Map<string, boolean>()
    for (const event of scanned) {
      if (!allowed.has(event.jobId)) {
        allowed.set(event.jobId, await this.permitted(principal, this.store.get(event.jobId)))
      }
    }
    void this.store
    return {
      generation: this.generation,
      resetRequired: false,
      events: scanned.filter((event) => allowed.get(event.jobId)),
      // Advance across denied rows too, without leaking their payload or repeatedly polling them.
      nextCursor: scanned.at(-1)?.sequence ?? after
    }
  }

  async snapshot(principal: CloudJobPrincipal, limit = 200, token?: string) {
    CloudId.parse(principal.id)
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new Error('Invalid job limit.')
    }
    const principalKey = `${principal.kind}:${principal.id}`
    const cursor = token === undefined ? undefined : this.cursors.decode(token)
    if (
      cursor &&
      (cursor.principal !== principalKey ||
        cursor.generation !== this.generation ||
        cursor.expiresAt <= Date.now())
    ) {
      throw new Error('Job snapshot cursor expired or belongs to another authority; refresh.')
    }
    const page = readJobSnapshotPage(this.store.db, limit, cursor)
    const jobs: CloudJob[] = []
    for (const job of page.jobs) {
      if (await this.permitted(principal, job)) {
        jobs.push(this.store.get(job.id))
      }
    }
    void this.store
    return {
      generation: this.generation,
      eventCursor: page.eventCursor,
      jobs,
      nextCursor:
        page.beforeRowId === null
          ? null
          : this.cursors.encode({
              principal: principalKey,
              generation: this.generation,
              upperRowId: page.upperRowId,
              beforeRowId: page.beforeRowId,
              eventCursor: page.eventCursor,
              expiresAt: cursor?.expiresAt ?? Date.now() + 300_000
            })
    }
  }

  async submit(principal: CloudJobPrincipal, raw: CloudJobInput): Promise<CloudJob> {
    return this.admitSubmission(principal, raw)
  }

  /** Main-only parent planner entry; deliberately absent from generic job RPC. */
  async submitAdamBound(
    principal: CloudJobPrincipal,
    raw: CloudJobInput,
    grant: unknown
  ): Promise<CloudJob> {
    if (grant === undefined) {
      throw new Error('ADAM binding capability is required.')
    }
    return this.admitSubmission(principal, raw, grant)
  }

  /** Main-only path: recovery comes from a verified service proof, never a caller principal string. */
  async submitAdamBoundForVerifiedAdam(
    raw: CloudJobInput,
    grant: unknown,
    assertAuthorityCurrent: () => void
  ): Promise<CloudJob> {
    return admitCloudJobSubmission(
      {
        readStore: () => this.store,
        canUseWorkspace: this.options.canUseWorkspace,
        ...(this.options.adamClient ? { adamClient: this.options.adamClient } : {})
      },
      { kind: 'local', id: 'adam' },
      raw,
      grant,
      { assertCurrent: assertAuthorityCurrent }
    )
  }

  prepareAdamBoundChildLookup(projectId: string): CloudJobAdamLookupReader {
    const store = this.store
    return createCloudJobAdamLookupReader(store.db, store, this.generation, projectId, () => ({
      store: this.currentStore,
      generation: this.generation,
      active:
        !this.closing && !this.workers.closing && this.options.authorityAvailable?.() !== false
    }))
  }

  private admitSubmission(principal: CloudJobPrincipal, raw: CloudJobInput, grant?: unknown) {
    return admitCloudJobSubmission(
      {
        readStore: () => this.store,
        canUseWorkspace: this.options.canUseWorkspace,
        ...(this.options.adamClient ? { adamClient: this.options.adamClient } : {})
      },
      principal,
      raw,
      grant
    )
  }

  async cancel(principal: CloudJobPrincipal, id: string, version: number): Promise<CloudJob> {
    await this.get(principal, id)
    return this.store.cancel(id, version)
  }

  async retry(principal: CloudJobPrincipal, id: string, version: number): Promise<CloudJob> {
    await this.get(principal, id)
    return this.store.retry(id, version)
  }

  async accept(principal: CloudJobPrincipal, id: string, version: number, receiptId: string) {
    this.administrator(principal)
    const job = await this.get(principal, id)
    const receipt = await this.options.verifyAcceptance?.(job, receiptId)
    if (!receipt) {
      throw new Error('Independent verification receipt is unavailable or invalid.')
    }
    if (JSON.stringify(this.store.get(id)) !== JSON.stringify(job)) {
      throw new Error('Job changed during verification; stale acceptance refused.')
    }
    return this.store.accept(id, version, receipt)
  }
}
