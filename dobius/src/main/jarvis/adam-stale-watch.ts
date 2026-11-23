// Stale alerts (build plan 7.16): a tracked job that has waited on Carson too
// long, an unanswered "needs you" reminded once, and a job working a long time
// with no new reply. Same rule as the conductor: what a model may hear is a
// fixed template plus an allowlisted name (shared/conductor-speech.ts); the
// terminal's title only reaches Carson's thread row.
import { conductorSpeech, speakableName } from '../../shared/conductor-speech'
import type {
  ConductorIdentity,
  ConductorRead,
  ConductorStaleJob
} from './adam-conductor-types'
import { clip, CONDUCTOR_NOTICE_MAX_CHARS, safeLabel } from './adam-conductor-text'

export type StaleCondition = 'waiting' | 'reminder' | 'working'

export type StaleThresholds = {
  waitingMinutes: number
  reminderMinutes: number
  workingMinutes: number
}

export type StaleAlert = {
  condition: StaleCondition
  event: 'still-waiting' | 'long-running'
  handle: string
  /** Allowlisted name: the only name a model may hear. */
  name: string
  minutes: number
  /** Template only: what a model may hear. */
  spoken: string
  /** For Carson's thread only (may show the terminal's title); never sent to a model. */
  display: string
  at: number
}

/** A stale job as the morning brief may tell ADAM: a speakable name and a fixed condition. */
export type StaleItem = { name: string; condition: 'waiting' | 'working'; minutes: number }

export type StaleWatchDeps = {
  jobs: () => ConductorStaleJob[]
  identify: (handle: string) => Promise<ConductorIdentity | null>
  read: (handle: string) => Promise<ConductorRead>
  thresholds: () => StaleThresholds
  /** The conductor's "ADAM reports finished work" setting. */
  enabled: () => boolean
  alert: (alert: StaleAlert) => void
  now?: () => number
}

const MINUTE = 60_000
// Why throttled: a reply check reads the agent's transcript file.
export const STALE_READ_EVERY_MS = 2 * MINUTE

function minutesSince(since: number, now: number): number {
  return Math.max(1, Math.floor((now - since) / MINUTE))
}

function displayOf(condition: StaleCondition, label: string, minutes: number): string {
  const text =
    condition === 'waiting'
      ? `${label} has been waiting on you for ${minutes} minutes.`
      : condition === 'reminder'
        ? `Reminder: ${label} still needs you (${minutes} minutes now).`
        : `${label} has been working for ${minutes} minutes with no new reply.`
  return clip(text, CONDUCTOR_NOTICE_MAX_CHARS)
}

/** Watches the conductor's jobs; each alert is given once per job, condition and wait. */
export class AdamStaleWatch {
  private readonly fired = new Set<string>()
  private readonly readAt = new Map<number, number>()
  private readonly now: () => number

  constructor(private readonly deps: StaleWatchDeps) {
    this.now = deps.now ?? Date.now
  }

  async check(): Promise<void> {
    if (!this.deps.enabled()) {
      return
    }
    const jobs = this.deps.jobs()
    this.prune(jobs)
    const limits = this.deps.thresholds()
    for (const job of jobs) {
      const due = await this.dueCondition(job, limits)
      if (due) {
        await this.fire(job, due.condition, due.since, due.key)
      }
    }
  }

  /** The jobs past a threshold right now, for the morning brief. */
  async current(): Promise<StaleItem[]> {
    const now = this.now()
    const limits = this.deps.thresholds()
    const items: StaleItem[] = []
    for (const job of this.deps.jobs()) {
      const waiting =
        job.needsYouSince !== null && now - job.needsYouSince >= limits.waitingMinutes * MINUTE
      const working = this.fired.has(`${job.id}:working`) && job.workingSince !== null
      const since = waiting ? job.needsYouSince : working ? job.workingSince : null
      if (since === null) {
        continue
      }
      const identity = await this.deps.identify(job.handle).catch(() => null)
      items.push({
        name: speakableName(identity?.agentName, identity?.project),
        condition: waiting ? 'waiting' : 'working',
        minutes: minutesSince(since, now)
      })
    }
    return items
  }

  private async dueCondition(
    job: ConductorStaleJob,
    limits: StaleThresholds
  ): Promise<{ condition: StaleCondition; since: number; key: string } | null> {
    const now = this.now()
    const waitedFor = job.needsYouSince === null ? 0 : now - job.needsYouSince
    if (job.needsYouSince !== null) {
      const reminder = `${job.id}:reminder:${job.needsYouSince}`
      const waiting = `${job.id}:waiting:${job.needsYouSince}`
      if (waitedFor >= limits.reminderMinutes * MINUTE && !this.fired.has(reminder)) {
        // Why the waiting key too: a reminder already covers the shorter alert.
        this.fired.add(waiting)
        return { condition: 'reminder', since: job.needsYouSince, key: reminder }
      }
      if (waitedFor >= limits.waitingMinutes * MINUTE && !this.fired.has(waiting)) {
        return { condition: 'waiting', since: job.needsYouSince, key: waiting }
      }
      return null
    }
    const working = `${job.id}:working`
    if (
      job.workingSince === null ||
      now - job.workingSince < limits.workingMinutes * MINUTE ||
      this.fired.has(working)
    ) {
      return null
    }
    return (await this.repliedLately(job, limits.workingMinutes * MINUTE))
      ? null
      : { condition: 'working', since: job.workingSince, key: working }
  }

  /** True when the agent wrote a reply within `window` (or the check is not due yet). */
  private async repliedLately(job: ConductorStaleJob, window: number): Promise<boolean> {
    const now = this.now()
    if (now - (this.readAt.get(job.id) ?? Number.NEGATIVE_INFINITY) < STALE_READ_EVERY_MS) {
      return true
    }
    this.readAt.set(job.id, now)
    const read = await this.deps.read(job.handle).catch(() => null)
    const at = read?.reply?.at ?? null
    return at !== null && at >= job.sentAt && now - at < window
  }

  private async fire(
    job: ConductorStaleJob,
    condition: StaleCondition,
    since: number,
    key: string
  ): Promise<void> {
    // Why claimed before the await: a second check must not alert twice.
    this.fired.add(key)
    const identity = await this.deps.identify(job.handle).catch(() => null)
    if (!this.deps.enabled() || !this.deps.jobs().some((current) => current.id === job.id)) {
      return
    }
    const now = this.now()
    const name = speakableName(identity?.agentName, identity?.project)
    const minutes = minutesSince(since, now)
    const event = condition === 'working' ? 'long-running' : 'still-waiting'
    this.deps.alert({
      condition,
      event,
      handle: job.handle,
      name,
      minutes,
      spoken: conductorSpeech([{ event, name, minutes }]),
      display: displayOf(condition, safeLabel(identity?.agentName || identity?.title), minutes),
      at: now
    })
  }

  /** Forgets jobs the conductor no longer tracks. */
  private prune(jobs: ConductorStaleJob[]): void {
    const ids = new Set(jobs.map((job) => String(job.id)))
    for (const key of this.fired) {
      if (!ids.has(key.split(':')[0])) {
        this.fired.delete(key)
      }
    }
    for (const id of this.readAt.keys()) {
      if (!ids.has(String(id))) {
        this.readAt.delete(id)
      }
    }
  }
}
