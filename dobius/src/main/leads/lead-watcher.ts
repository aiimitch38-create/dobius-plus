import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { VertexWorkBoard } from '../../shared/vertex-task-types'
import { leadStateDir } from './lead-seed'

export const LEAD_POLL_INTERVAL_MS = 30_000
/** A spawn request is fire-and-forget; wait this long before asking again. */
export const LEAD_SPAWN_GRACE_MS = 2 * 60_000
/** Consecutive launches that never became a running agent before the watcher stops spawning. */
export const LEAD_MAX_LAUNCH_FAILURES = 3
export const LEAD_WATCHER_AUTHOR = 'dobius-lead-watcher'
export const SEEN_FILE_NAME = 'seen.json'
const SEEN_CAP = 1000

export type LeadWatcherStore = Pick<VertexWorkBoard, 'listFiltered'> &
  Partial<Pick<VertexWorkBoard, 'comment'>>

/**
 * What the lead terminal is doing, mirroring the Board delivery gate
 * (renderer board-delivery/delivery-gate.ts): only an idle agent gets typed
 * into; a busy agent or dialog waits; a bare shell never does.
 */
export type LeadConsoleAgentState = 'idle' | 'busy' | 'shell'

export type LeadConsoleProbe = { handle: string; agent: LeadConsoleAgentState }

/** Maps the runtime's per-terminal agent status onto the delivery states above. */
export function classifyAgentStatus(status: {
  isRunningAgent: boolean
  status: 'working' | 'permission' | 'idle' | null
}): LeadConsoleAgentState {
  if (!status.isRunningAgent) {
    return 'shell'
  }
  if (status.status === 'working' || status.status === 'permission') {
    return 'busy'
  }
  // Why: `null` with a running agent means the process is up but no status
  // hook reported; with no busy signal present it is treated as waiting for input.
  return 'idle'
}

export type LeadWatcherDeps = {
  profile: string
  projectId: string
  store: LeadWatcherStore
  /** Connected consoles with role `lead:<profile>`, each with its agent state (shell included). */
  listLeadConsoles: () => Promise<LeadConsoleProbe[]>
  /**
   * Ask the Board to open the lead console. `delivered: false` means no window
   * or client was attached to receive the request; the watcher asks again on
   * the next poll instead of waiting out the spawn grace period.
   */
  spawnLeadConsole: () => Promise<{ delivered: boolean }>
  /** Type one line into the console and press Enter. */
  sendText: (handle: string, text: string) => Promise<void>
  homeDir?: string
  now?: () => number
  log?: (message: string, error?: unknown) => void
  pollIntervalMs?: number
}

export type LeadPollResult = {
  readyIds: string[]
  spawned: boolean
  nudged: boolean
  /** The lead agent was busy or on a dialog; ids stay unseen for the next poll. */
  deferred: boolean
  /** Spawning is suspended after repeated failed launches; see status().lastError. */
  halted: boolean
  /** Cards that received the "lead could not start" comment on this poll. */
  commentedIds: string[]
}

export type LeadWatcherStatus = {
  profile: string
  projectId: string
  running: boolean
  seenCount: number
  lastPollAt: number | null
  lastError: string | null
  launchFailures: number
  halted: boolean
}

type SeenState = {
  seen: string[]
  /** Cards already told that the lead could not start; one comment each, ever. */
  haltCommented: string[]
}

export function buildNudgeText(ids: readonly string[]): string {
  // Why: ids only. Titles and bodies are untrusted and must never be typed into an agent.
  return `Cards ready: ${ids.join(', ')}. Run the Card Loop.`
}

export function buildHaltReason(profile: string): string {
  return `lead console keeps exiting — check the Hermes profile ${profile} (hermes -p ${profile} chat)`
}

export function buildHaltComment(profile: string): string {
  return `Lead ${profile} could not start: ${LEAD_MAX_LAUNCH_FAILURES} launches in a row ended without a running agent. Check the Hermes profile (hermes -p ${profile} chat), then run \`dobius lead start\` to retry.`
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
}

function readSeenState(
  filePath: string,
  log: (message: string, error?: unknown) => void
): SeenState {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { seen: [], haltCommented: [] }
    }
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    // Why: seen.json is a cache; a corrupt file costs one duplicate nudge, not a dead lead.
    log(`[lead-watcher] ignoring unreadable ${filePath}`, error)
    return { seen: [], haltCommented: [] }
  }
  const record =
    typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  return { seen: stringList(record.seen), haltCommented: stringList(record.haltCommented) }
}

function writeSeenState(filePath: string, state: SeenState): void {
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2))
  renameSync(tmp, filePath)
}

export class LeadWatcher {
  private timer: ReturnType<typeof setInterval> | null = null
  private polling = false
  private spawnRequestedAt: number | null = null
  /** A delivered spawn whose outcome (agent up / shell / timeout) is not yet known. */
  private launchPending = false
  private launchFailures = 0
  private haltReason: string | null = null
  private lastPollAt: number | null = null
  private lastError: string | null = null
  private readonly seenPath: string
  private state: SeenState

  constructor(private readonly deps: LeadWatcherDeps) {
    const dir = leadStateDir(deps.profile, deps.homeDir)
    mkdirSync(dir, { recursive: true })
    this.seenPath = join(dir, SEEN_FILE_NAME)
    this.state = readSeenState(this.seenPath, (message, error) => this.log(message, error))
  }

  start(): void {
    if (this.timer) {
      return
    }
    const interval = this.deps.pollIntervalMs ?? LEAD_POLL_INTERVAL_MS
    this.timer = setInterval(() => void this.tick(), interval)
    this.timer.unref?.()
    void this.tick()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** `lead start` on a running watcher: forget past failures and allow spawning again. */
  resetLaunchFailures(): void {
    this.launchFailures = 0
    this.launchPending = false
    this.haltReason = null
    this.spawnRequestedAt = null
  }

  status(): LeadWatcherStatus {
    return {
      profile: this.deps.profile,
      projectId: this.deps.projectId,
      running: this.timer !== null,
      seenCount: this.state.seen.length,
      lastPollAt: this.lastPollAt,
      lastError: this.haltReason ?? this.lastError,
      launchFailures: this.launchFailures,
      halted: this.haltReason !== null
    }
  }

  /** Timer entry point: never throws, never overlaps. */
  async tick(): Promise<LeadPollResult | null> {
    if (this.polling) {
      return null
    }
    this.polling = true
    try {
      const result = await this.poll()
      this.lastError = null
      return result
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      this.log(`[lead-watcher:${this.deps.profile}] poll failed`, error)
      return null
    } finally {
      this.polling = false
    }
  }

  async poll(): Promise<LeadPollResult> {
    const now = this.now()
    this.lastPollAt = now
    const result: LeadPollResult = {
      readyIds: [],
      spawned: false,
      nudged: false,
      deferred: false,
      halted: false,
      commentedIds: []
    }

    const ready = this.deps.store.listFiltered({
      status: 'todo',
      assigneeId: this.deps.profile,
      projectId: this.deps.projectId
    })
    const seen = new Set(this.state.seen)
    result.readyIds = ready.map((task) => task.id).filter((id) => !seen.has(id))
    if (result.readyIds.length === 0) {
      result.halted = this.haltReason !== null
      return result
    }

    const probes = await this.deps.listLeadConsoles()
    // Why: a lead card at a bare shell is not a lead; typing into it would run
    // "Cards ready: …" as a command. Such cards are replaced by the spawn path.
    const agents = probes.filter((c) => c.agent !== 'shell')

    if (agents.length > 0) {
      // A running agent proves the launch works: clear every failure signal.
      this.launchPending = false
      this.launchFailures = 0
      this.haltReason = null
      this.spawnRequestedAt = null
      const idle = agents.find((c) => c.agent === 'idle')
      if (!idle) {
        // Why: the agent is mid-turn or on a dialog; the text would queue or feed
        // the dialog. Try again next poll with the ids still unseen.
        result.deferred = true
        return result
      }
      await this.deps.sendText(idle.handle, buildNudgeText(result.readyIds))
      result.nudged = true
      this.markSeen(result.readyIds)
      return result
    }

    this.judgePendingLaunch(probes, now)

    if (this.haltReason) {
      result.halted = true
      result.commentedIds = this.commentHaltOnce(result.readyIds)
      return result
    }

    const recentlyRequested =
      this.spawnRequestedAt !== null && now - this.spawnRequestedAt < LEAD_SPAWN_GRACE_MS
    if (!recentlyRequested) {
      const { delivered } = await this.deps.spawnLeadConsole()
      // Why: an undelivered request (no window yet) must not arm the grace
      // period, or the lead would sit idle for two minutes after the window opens.
      this.spawnRequestedAt = delivered ? now : null
      this.launchPending = delivered
      result.spawned = delivered
    }
    // Why: the console appears asynchronously; the nudge goes out on a later poll,
    // once there is a terminal to type into. The ids stay unseen until then.
    return result
  }

  /** One delivered launch counts as one failure when it ends at a shell or times out. */
  private judgePendingLaunch(probes: LeadConsoleProbe[], now: number): void {
    if (!this.launchPending) {
      return
    }
    const endedAtShell = probes.some((c) => c.agent === 'shell')
    const timedOut =
      this.spawnRequestedAt !== null && now - this.spawnRequestedAt >= LEAD_SPAWN_GRACE_MS
    if (!endedAtShell && !timedOut) {
      return
    }
    this.launchPending = false
    // Why: the failed launch's shell card must be replaced right away, not after the grace period.
    this.spawnRequestedAt = null
    this.launchFailures += 1
    if (this.launchFailures >= LEAD_MAX_LAUNCH_FAILURES) {
      this.haltReason = buildHaltReason(this.deps.profile)
      this.log(`[lead-watcher:${this.deps.profile}] ${this.haltReason}`)
    }
  }

  private commentHaltOnce(ids: string[]): string[] {
    if (!this.deps.store.comment) {
      return []
    }
    const done = new Set(this.state.haltCommented)
    const fresh = ids.filter((id) => !done.has(id))
    if (fresh.length === 0) {
      return []
    }
    for (const id of fresh) {
      this.deps.store.comment(id, LEAD_WATCHER_AUTHOR, buildHaltComment(this.deps.profile))
    }
    this.state.haltCommented = [...this.state.haltCommented, ...fresh].slice(-SEEN_CAP)
    writeSeenState(this.seenPath, this.state)
    return fresh
  }

  private markSeen(ids: string[]): void {
    const merged = [...this.state.seen, ...ids]
    this.state.seen = merged.slice(Math.max(0, merged.length - SEEN_CAP))
    writeSeenState(this.seenPath, this.state)
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  private log(message: string, error?: unknown): void {
    if (this.deps.log) {
      this.deps.log(message, error)
      return
    }
    console.warn(message, error)
  }
}
