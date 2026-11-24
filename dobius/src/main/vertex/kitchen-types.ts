/* The kitchen manager's limits and types (see kitchen.ts). */

import type { ExecutionAdmission } from '../agents/execution-gate'
import type { VertexTask, VertexTaskPatch } from '../../shared/vertex-task-types'
import type { BugAutoFixRepo, BugAutoFixWorktree } from './bug-autofix'

export const KITCHEN_MAX_COOKS = 3
export const KITCHEN_DEFAULT_MAX_MINUTES = 45
export const KITCHEN_PUMP_MS = 30_000
/** A fresh cook (or one found again after a restart) may not report yet. */
export const KITCHEN_GRACE_MS = 2 * 60_000
/** Working with no terminal output for this long counts as stuck. */
export const KITCHEN_STUCK_MS = 10 * 60_000
/** Why a delay: a prompt Carson answers at once must not be reported. */
export const KITCHEN_NEEDS_CARSON_AFTER_MS = 60_000
/** Idle on this many pumps in a row is a finished turn, not a pause between tools. */
export const KITCHEN_IDLE_PUMPS_TO_FINISH = 2
export const KITCHEN_REASON_LIMIT = 300

export type KitchenCookStatus = {
  /** 'gone': no running agent in the cook's workspace. */
  state: 'working' | 'permission' | 'idle' | 'gone'
  lastOutputAt: number | null
}

export type KitchenEvent = 'finished' | 'blocked' | 'needs-carson'

/** What ADAM is told. `title` is for Carson's thread row only; no model hears it. */
export type KitchenNotice = { event: KitchenEvent; taskId: string; title: string; at: number }

export type KitchenStatus = {
  enabled: boolean
  /** False while the crew is paused (or its state cannot be read). */
  crewRunning: boolean
  cooking: number
  waiting: number
  maxCooks: number
  maxMinutes: number
}

export type KitchenDeps = {
  listTasks: () => VertexTask[]
  updateTask: (taskId: string, patch: VertexTaskPatch) => VertexTask | null
  /** The stop switch: the kitchen setting. */
  isEnabled: () => boolean
  maxMinutes: () => number
  admission: () => ExecutionAdmission
  findRepos: (projectId: string) => BugAutoFixRepo[]
  createWorktree: (req: {
    repoId: string
    name: string
    prompt: string
    comment: string
    /** `refusal`: the workspace is not the cook's own; whatever runs in it must be stopped. */
  }) => Promise<BugAutoFixWorktree & { refusal?: string }>
  /** Throwing means unknown: nothing is decided on that pump. */
  cookStatus: (worktreeId: string) => Promise<KitchenCookStatus>
  /** Stops whatever runs in the workspace, then starts the restricted agent again. */
  restartCook: (req: { worktreeId: string; prompt: string }) => Promise<void>
  stopCook: (worktreeId: string) => Promise<void>
  findWorktree: (repoId: string, name: string) => Promise<BugAutoFixWorktree | null | 'unknown'>
  tellAdam: (notice: KitchenNotice) => void
  unsupportedReason?: () => string | null
  graceMs?: number
  now?: () => number
  log?: (message: string, error?: unknown) => void
}
