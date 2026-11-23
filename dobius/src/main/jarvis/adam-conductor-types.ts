// The conductor's types, apart so adam-conductor.ts stays one class.
import type { ConductorEvent } from '../../shared/conductor-speech'

export type ConductorStatus = {
  isRunningAgent: boolean
  status: 'working' | 'permission' | 'idle' | null
}

/** What the agent last said, from its transcript (or screen), for the notice. */
export type ConductorRead = {
  /** The agent's last reply and when it was written (null = no timestamp). */
  reply: { text: string; at: number | null } | null
  /** The visible screen lines, top to bottom, for a question the transcript lacks. */
  screen: string[]
}

export type ConductorNoticeKind = 'done' | 'needs-you'

export type ConductorNotice = {
  kind: ConductorNoticeKind
  event: Extract<ConductorEvent, 'done' | 'unclear' | 'needs-you'>
  handle: string
  /** Allowlisted name or "a terminal (in <project>)": the only name a model may hear. */
  name: string
  /** Template only ("Juniper finished."): what a model may hear. */
  spoken: string
  /** For Carson's thread only (may quote the agent, secret-filtered); never sent to a model. */
  display: string
  at: number
}

/** A progress line while a job runs: voice only, template only. */
export type ConductorProgress = {
  event: Extract<ConductorEvent, 'started' | 'progress'>
  handle: string
  name: string
  minutes?: number
}

/** Who a terminal is: its agent name and project (for speech), its title (display only). */
export type ConductorIdentity = {
  agentName: string | null
  project: string | null
  title: string | null
}

export type ConductorDeps = {
  status: (handle: string) => Promise<ConductorStatus>
  read: (handle: string) => Promise<ConductorRead>
  /** The terminal's names, or null when it is gone. */
  identify: (handle: string) => Promise<ConductorIdentity | null>
  report: (notice: ConductorNotice) => void
  progress?: (update: ConductorProgress) => void
  /** The "Progress updates" setting (only asked while reports are on). */
  progressEnabled?: () => boolean
  /** Reports were switched off: anything still waiting to be said is dropped. */
  cleared?: () => void
  /** The "ADAM reports finished work" setting. */
  enabled: () => boolean
  now?: () => number
  setInterval?: (run: () => void, ms: number) => unknown
  clearInterval?: (timer: unknown) => void
}

export type DispatchSource = 'quick-hands' | 'cli'

export type Tracked = {
  /** Unique per dispatch: a newer send to the same terminal replaces this one. */
  id: number
  handle: string
  source: DispatchSource
  sentAt: number
  sawWorking: boolean
  /** The agent's last reply when ADAM sent the work (undefined = not read yet). */
  baselineReply: string | null | undefined
  replyCheckedAt: number
  /** When the current done / needs-you reading began; it must hold SETTLE_MS. */
  settling: { kind: ConductorNoticeKind; since: number } | null
  /** A notice was already given for this stretch of waiting. */
  askedAt: number | null
  /** First time the agent was seen working on this dispatch, and the last progress line. */
  workingSince: number | null
  progressAt: number
}
