// Idle-time memory tidy (7.13): Hermes compacts ADAM's context when a turn
// starts near its threshold, which takes 2 to 3 minutes. Landing mid-call is
// what Carson hears as ADAM going silent. So after a quiet stretch with no
// turn and no call, and only when the context is close to that threshold,
// main asks Hermes to compact now (the `session.compress` RPC,
// tui_gateway/methods_session.py), and the next turn starts lean.
import type { AdamHermesVoiceOptions } from './adam-hermes-voice-types'
import { contextPercentOf } from './adam-progress'
import type { HermesRpc } from './hermes-desktop-rpc'

export const ADAM_IDLE_TIDY_AFTER_MS = 10 * 60_000
export const ADAM_IDLE_TIDY_CHECK_MS = 60_000
// Why 40 percent: Hermes reports how full the context is (usage.context_percent)
// but not the share it compacts at. Its built-in default is 50 percent
// (ContextCompressor threshold_percent); 40 is "near" that default. A profile
// with a higher threshold just tidies a little early, still while idle.
export const ADAM_IDLE_TIDY_MIN_PERCENT = 40

/** One idle compaction on an open session; resolves with the new context percent. */
export async function compactNow(
  rpc: HermesRpc,
  sessionId: string,
  options: AdamHermesVoiceOptions
): Promise<number | null> {
  options.onCompacting?.(true)
  try {
    const result = await rpc.request(
      'session.compress',
      { session_id: sessionId },
      options.compactionTimeoutMs ?? 720_000
    )
    return contextPercentOf(result)
  } finally {
    options.onCompacting?.(false)
  }
}

export type AdamIdleTidyDeps = {
  /** True while ADAM runs a turn (any source) or a live call is open. */
  busy: () => boolean
  /** Hermes' last reported context use, in percent; null = unknown. */
  contextPercent: () => number | null
  /** Asks Hermes to compact; false when it could not even ask. */
  tidy: () => Promise<boolean>
  log?: (text: string) => void
  now?: () => number
  setInterval?: (run: () => void, ms: number) => unknown
  clearInterval?: (timer: unknown) => void
}

/**
 * Watches for one idle stretch at a time. Any busy reading starts a new
 * stretch; each stretch gets at most one tidy, whatever its outcome.
 */
export class AdamIdleTidy {
  private quietSince: number
  private triedThisStretch = false
  private timer: unknown = null
  private readonly now: () => number

  constructor(private readonly deps: AdamIdleTidyDeps) {
    this.now = deps.now ?? Date.now
    this.quietSince = this.now()
  }

  start(): void {
    if (this.timer !== null) {
      return
    }
    const timer = (this.deps.setInterval ?? ((run, ms) => setInterval(run, ms)))(
      () => this.tick(),
      ADAM_IDLE_TIDY_CHECK_MS
    )
    ;(timer as { unref?: () => void } | null)?.unref?.()
    this.timer = timer
  }

  stop(): void {
    if (this.timer !== null) {
      ;(this.deps.clearInterval ?? ((t) => clearInterval(t as NodeJS.Timeout)))(this.timer)
      this.timer = null
    }
  }

  /** Something happened (a turn, a call): the quiet stretch starts over. */
  activity(): void {
    this.quietSince = this.now()
    this.triedThisStretch = false
  }

  tick(): void {
    if (this.deps.busy()) {
      this.activity()
      return
    }
    if (this.triedThisStretch || this.now() - this.quietSince < ADAM_IDLE_TIDY_AFTER_MS) {
      return
    }
    const percent = this.deps.contextPercent()
    if (percent === null || percent < ADAM_IDLE_TIDY_MIN_PERCENT) {
      return
    }
    this.triedThisStretch = true
    this.deps.log?.(`idle tidy at ${Math.round(percent)}% context`)
    void this.deps.tidy().catch((error: unknown) => {
      this.deps.log?.(`idle tidy failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }
}

let running: AdamIdleTidy | null = null

/** Starts the one watcher for ADAM's one Hermes session; later calls keep it (window re-creation). */
export function startAdamIdleTidy(deps: AdamIdleTidyDeps): AdamIdleTidy {
  if (!running) {
    running = new AdamIdleTidy({ log: (text) => console.info(`[adam] ${text}`), ...deps })
    running.start()
  }
  return running
}

/**
 * A real lifecycle edge (an ADAM turn or a live call starting or ending): the
 * quiet stretch starts over. Why not only the poll: a turn shorter than one
 * poll would go unseen, and a tidy could start right after it.
 */
export function noteAdamActivity(): void {
  running?.activity()
}

/** Runs one ADAM turn with its start and its end counted as activity. */
export function withAdamActivity<T>(work: () => Promise<T>): Promise<T> {
  noteAdamActivity()
  return work().finally(noteAdamActivity)
}
