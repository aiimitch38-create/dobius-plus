import { z } from 'zod'
import { CloudJob, CloudJobState, type CloudJob as Job } from './cloud-jobs'

export const CLOUD_JOB_LABELS: Record<Job['state'], string> = {
  queued: 'Queued',
  waiting_for_worker: 'Waiting',
  running: 'Running',
  needs_review: 'Needs review',
  completed: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
  interrupted: 'Interrupted'
}
export type CloudJobReadMethod = 'jobs.status' | 'jobs.snapshot' | 'jobs.events' | 'jobs.get'
export type CloudJobReadSource = {
  key: string
  read(method: CloudJobReadMethod, params?: unknown): Promise<unknown>
}
const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const generation = z.string().min(1).max(256)
export const CloudBoardStatus = z
  .object({
    configured: z.boolean(),
    dispatchEnabled: z.boolean(),
    liveDispatchReady: z.boolean(),
    generation: generation.optional()
  })
  .refine((s) => !s.configured || !!s.generation, 'Configured authority needs a generation')
export const CloudBoardSnapshot = z.object({
  generation,
  eventCursor: counter,
  jobs: z.array(CloudJob).max(200),
  nextCursor: z.string().min(1).max(1024).nullable()
})
export const CloudBoardEvents = z.object({
  generation,
  resetRequired: z.boolean(),
  nextCursor: counter,
  events: z
    .array(
      z.object({
        sequence: counter,
        jobId: z.string().min(1),
        version: z.number().int().positive(),
        state: CloudJobState,
        at: counter,
        reason: z.string()
      })
    )
    .max(200)
})
export type CloudJobBoardState = {
  phase:
    | 'choose_authority'
    | 'loading'
    | 'ready'
    | 'unconfigured'
    | 'offline'
    | 'stale'
    | 'denied'
    | 'unavailable'
  jobs: Job[]
  service: z.infer<typeof CloudBoardStatus> | null
  error: string | null
  updatedAt: number | null
}
export const emptyCloudJobBoard = (chosen = false): CloudJobBoardState => ({
  phase: chosen ? 'loading' : 'choose_authority',
  jobs: [],
  service: null,
  error: null,
  updatedAt: null
})
export function cloudJobBoardNotice(state: CloudJobBoardState): string | null {
  const messages: Partial<Record<CloudJobBoardState['phase'], string>> = {
    choose_authority: 'Choose the registered VPS authority to load jobs.',
    loading: 'Loading jobs…',
    unconfigured: 'The job service is not configured on this host.',
    offline: 'The job service is offline.',
    stale: 'Job updates are unavailable. Showing the last verified snapshot.',
    denied: 'Job access was denied. Cached data has been cleared.',
    unavailable: 'The job service is unavailable or requires a host update.'
  }
  if (state.phase !== 'ready') {
    return messages[state.phase] ?? null
  }
  if (!state.service?.dispatchEnabled) {
    return 'Dispatch is paused.'
  }
  if (!state.service.liveDispatchReady) {
    return 'Worker prerequisites are not ready.'
  }
  return null
}
class SnapshotReset extends Error {}

/** Both apps use this read-only projection; no task or job writes exist here. */
export class CloudJobBoardController {
  state: CloudJobBoardState
  private disposed = false
  private pending: Promise<void> | null = null
  private listeners = new Set<(state: CloudJobBoardState) => void>()
  constructor(
    private readonly source: CloudJobReadSource,
    private readonly now = Date.now
  ) {
    this.state = emptyCloudJobBoard(true)
  }
  subscribe(listener: (state: CloudJobBoardState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  dispose(): void {
    this.disposed = true
    this.listeners.clear()
  }
  private publish(next: CloudJobBoardState): void {
    if (this.disposed) {
      return
    }
    this.state = next
    this.listeners.forEach((listener) => listener(next))
  }
  private async read(method: CloudJobReadMethod, params?: unknown): Promise<unknown> {
    const result = await this.source.read(method, params)
    if (this.disposed) {
      throw new SnapshotReset('Reader disposed')
    }
    return result
  }
  refresh(): Promise<void> {
    if (this.disposed) {
      return Promise.resolve()
    }
    if (!this.pending) {
      this.pending = this.load().finally(() => {
        this.pending = null
      })
    }
    return this.pending
  }
  private async load(): Promise<void> {
    try {
      for (let retry = 0; retry < 2; retry++) {
        try {
          await this.snapshot()
          return
        } catch (error) {
          if (!(error instanceof SnapshotReset) || this.disposed) {
            throw error
          }
          this.publish(emptyCloudJobBoard(true))
        }
      }
      throw new Error('Job authority changed repeatedly; refresh.')
    } catch (error) {
      if (this.disposed) {
        return
      }
      const message = error instanceof Error ? error.message : 'Job read failed'
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      const denied = /forbidden|unauthorized|access denied|permission|authenticated/i.test(
        code + message
      )
      const invalid =
        error instanceof z.ZodError ||
        /method_not_found|unknown method|not configured|cursor|generation|snapshot|event/i.test(
          code + message
        )
      const phase = denied
        ? 'denied'
        : invalid
          ? 'unavailable'
          : this.state.updatedAt !== null
            ? 'stale'
            : 'offline'
      this.publish({
        ...this.state,
        phase,
        error: message,
        ...(denied || invalid ? { jobs: [], updatedAt: null, service: null } : {})
      })
    }
  }
  private async snapshot(): Promise<void> {
    const service = CloudBoardStatus.parse(await this.read('jobs.status'))
    if (!service.configured) {
      this.publish({ ...emptyCloudJobBoard(), phase: 'unconfigured', service })
      return
    }
    if (this.state.service?.generation && this.state.service.generation !== service.generation) {
      this.publish(emptyCloudJobBoard(true))
    }
    const jobs = new Map<string, Job>()
    const cursors = new Set<string>()
    let cursor: string | undefined
    let watermark: number | null = null
    // Re-authorize the complete snapshot on each refresh: permission revocation
    // need not generate a public job event, so an event-only cache could leak it.
    for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
      const page = CloudBoardSnapshot.parse(
        await this.read('jobs.snapshot', { limit: 200, ...(cursor ? { cursor } : {}) })
      )
      if (page.generation !== service.generation) {
        throw new SnapshotReset('Snapshot generation changed')
      }
      if (watermark !== null && watermark !== page.eventCursor) {
        throw new Error('Snapshot watermark changed')
      }
      watermark = page.eventCursor
      for (const job of page.jobs) {
        if ((jobs.get(job.id)?.version ?? 0) < job.version) {
          jobs.set(job.id, job)
        }
      }
      if (page.nextCursor === null) {
        break
      }
      if (cursors.has(page.nextCursor) || pageNumber === 99) {
        throw new Error('Snapshot paging exceeded its bound')
      }
      cursors.add(page.nextCursor)
      cursor = page.nextCursor
    }
    let after = watermark!
    for (let batch = 0; batch < 100; batch++) {
      const update = CloudBoardEvents.parse(await this.read('jobs.events', { after, limit: 200 }))
      if (update.resetRequired || update.generation !== service.generation) {
        throw new SnapshotReset('Event generation reset')
      }
      if (update.nextCursor < after) {
        throw new Error('Event cursor regressed')
      }
      for (const event of update.events) {
        if (event.sequence <= after || event.sequence > update.nextCursor) {
          throw new Error('Event sequence outside cursor window')
        }
        if ((jobs.get(event.jobId)?.version ?? 0) >= event.version) {
          continue
        }
        const { job } = z
          .object({ job: CloudJob })
          .parse(await this.read('jobs.get', { id: event.jobId }))
        if (job.id !== event.jobId || job.version < event.version) {
          throw new Error('Event job identity/version mismatch')
        }
        if ((jobs.get(job.id)?.version ?? 0) < job.version) {
          jobs.set(job.id, job)
        }
      }
      if (update.nextCursor === after) {
        break
      }
      if (batch === 99) {
        throw new Error('Event catch-up exceeded its bound')
      }
      after = update.nextCursor
    }
    this.publish({
      phase: 'ready',
      jobs: [...jobs.values()].sort(
        (a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)
      ),
      service,
      error: null,
      updatedAt: this.now()
    })
  }
}
