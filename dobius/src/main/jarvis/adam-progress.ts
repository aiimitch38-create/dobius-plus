// Hermes turn events as progress steps for the live voice (7.13). Only the
// step leaves this file; the phrase is fixed (shared/adam-progress.ts).
import type { AdamProgressStep } from '../../shared/adam-progress'
import type { HermesDesktopEvent } from './hermes-desktop-rpc'

/** At most one progress note per this long (Carson's spec, 2026-11-22). */
export const ADAM_PROGRESS_MIN_GAP_MS = 3_000

const BY_NAME: Record<string, AdamProgressStep> = {
  read_terminal: 'terminal-read',
  read_window_below: 'terminal-read',
  read_file: 'reading',
  write_file: 'editing',
  patch: 'editing',
  edit_file: 'editing',
  search_files: 'searching',
  session_search: 'memory',
  memory: 'memory',
  web_search: 'web',
  web_extract: 'web',
  x_search: 'web',
  delegate_task: 'helper',
  todo: 'tasks',
  todo_list: 'tasks',
  skill_view: 'skills',
  skills_list: 'skills',
  execute_code: 'code'
}

const DOBIUS_COMMAND = /^\s*(?:\S*\/)?dobius(?:\s|$)/

function commandOf(payload: Record<string, unknown>): string {
  const args = payload.args
  const command = args && typeof args === 'object' ? (args as { command?: unknown }).command : null
  return typeof command === 'string' ? command : ''
}

function stepOfTool(payload: Record<string, unknown>): AdamProgressStep {
  const name = typeof payload.name === 'string' ? payload.name : ''
  if (name === 'terminal') {
    // Why the command is only tested, never forwarded: it is terminal text.
    return DOBIUS_COMMAND.test(commandOf(payload)) ? 'dobius-command' : 'terminal'
  }
  if (name.startsWith('browser')) {
    return 'browser'
  }
  return BY_NAME[name] ?? 'tool'
}

/**
 * The step a Hermes event shows ADAM taking, or null for events that are not
 * progress. Event names from tui_gateway v0.22.0: tool.start (tool_progress.py
 * _on_tool_start, payload name/args), subagent.start, and status.update with
 * kind "compacting" (server.py _status_update).
 */
export function progressStepOf(event: HermesDesktopEvent): AdamProgressStep | null {
  const payload = event.payload ?? {}
  switch (event.type) {
    case 'tool.start':
      return stepOfTool(payload)
    case 'subagent.start':
      return 'helper'
    case 'status.update':
      return payload.kind === 'compacting' ? 'tidying' : null
    default:
      return null
  }
}

/**
 * How full ADAM's context is, from a usage report (message.complete,
 * session.usage, session.compress). Hermes sends `usage.context_percent`
 * (agent/context_breakdown.py context_usage_fields); null when absent.
 */
export function contextPercentOf(payload: Record<string, unknown> | undefined): number | null {
  const info = payload?.info
  for (const usage of [payload?.usage, info && typeof info === 'object' ? (info as { usage?: unknown }).usage : null]) {
    const percent =
      usage && typeof usage === 'object' ? (usage as { context_percent?: unknown }).context_percent : null
    if (typeof percent === 'number' && Number.isFinite(percent) && percent >= 0) {
      return percent
    }
  }
  return null
}

type ThrottleDeps = {
  send: (step: AdamProgressStep) => void
  now?: () => number
  setTimeout?: (run: () => void, ms: number) => unknown
  clearTimeout?: (timer: unknown) => void
}

/**
 * One note per ADAM_PROGRESS_MIN_GAP_MS, never the same step twice in a row.
 * A step that comes too soon waits, and a newer one replaces it, so the last
 * note is always what ADAM is doing now.
 */
export class AdamProgressThrottle {
  private lastStep: AdamProgressStep | null = null
  private lastAt = Number.NEGATIVE_INFINITY
  private waiting: AdamProgressStep | null = null
  private timer: unknown = null

  constructor(private readonly deps: ThrottleDeps) {}

  offer(step: AdamProgressStep): void {
    const now = (this.deps.now ?? Date.now)()
    if (now - this.lastAt >= ADAM_PROGRESS_MIN_GAP_MS && this.timer === null) {
      this.emit(step, now)
      return
    }
    this.waiting = step
    if (this.timer === null) {
      const wait = Math.max(0, this.lastAt + ADAM_PROGRESS_MIN_GAP_MS - now)
      const timer = (this.deps.setTimeout ?? ((run, ms) => setTimeout(run, ms)))(
        () => this.flush(),
        wait
      )
      ;(timer as { unref?: () => void } | null)?.unref?.()
      this.timer = timer
    }
  }

  /** A new turn (or none): forget the last step and drop anything waiting. */
  reset(): void {
    if (this.timer !== null) {
      ;(this.deps.clearTimeout ?? ((t) => clearTimeout(t as NodeJS.Timeout)))(this.timer)
    }
    this.timer = null
    this.waiting = null
    this.lastStep = null
    this.lastAt = Number.NEGATIVE_INFINITY
  }

  private flush(): void {
    this.timer = null
    const step = this.waiting
    this.waiting = null
    if (step) {
      this.emit(step, (this.deps.now ?? Date.now)())
    }
  }

  private emit(step: AdamProgressStep, now: number): void {
    if (step === this.lastStep) {
      return
    }
    this.lastStep = step
    this.lastAt = now
    this.deps.send(step)
  }
}
