/* Vertex-owned tasks.
 *
 * NOT the same thing as `task-providers.ts`. That module models tasks that
 * live in GitHub / GitLab / Linear / Jira and are read into the existing Tasks
 * surface — Dobius is a viewer there, and the external service is the master.
 *
 * These are the opposite: Vertex owns the record. A Vertex task is created
 * here, assigned to an agent here, and moved here. External systems become
 * optional sync targets, never the source of truth. The two surfaces coexist
 * deliberately; do not merge them.
 *
 * The `VertexTaskSource` contract below is the ONLY interface the Kanban UI
 * uses, so the renderer never learns where tasks are stored. */

export type VertexTaskStatus =
  | 'backlog'
  | 'todo'
  | 'in-progress'
  | 'blocked'
  | 'review'
  | 'testing'
  | 'done'

/** Where a task is meant to live.
 *
 * 'system' stays inside Dobius: Vertex owns it end to end and no external
 * service is told about it. 'asana' means it is destined for Asana — the
 * routing target, NOT a claim that it has been synced. Nothing pushes to
 * Asana yet, so treat this as the operator's stated intent for the task. */
export type VertexTaskDestination = 'system' | 'asana'
export type VertexTaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type VertexTaskType =
  | 'feature'
  | 'design'
  | 'integration'
  | 'ai'
  | 'security'
  | 'infra'
  | 'bug'

export const VERTEX_TASK_STATUSES: readonly VertexTaskStatus[] = [
  'backlog',
  'todo',
  'in-progress',
  'blocked',
  'review',
  'testing',
  'done',
]
export const VERTEX_TASK_DESTINATIONS: readonly VertexTaskDestination[] = ['system', 'asana']
export const VERTEX_TASK_PRIORITIES: readonly VertexTaskPriority[] = [
  'low',
  'medium',
  'high',
  'urgent',
]
export const VERTEX_TASK_TYPES: readonly VertexTaskType[] = [
  'feature',
  'design',
  'integration',
  'ai',
  'security',
  'infra',
  'bug',
]

/** Who a task is on. `agentId` points at a Dobius custom agent (agents-store);
 * `personId` is a human. Exactly one is expected, but neither is required —
 * an unassigned task is normal.
 *
 * 'hermes-profile' is a Hermes lead (`lead-<slug>`) and 'console' a Board
 * worker console: both pick cards up through the `dobius tasks` CLI, never
 * through the board's auto-dispatch, which only fires for 'agent'. */
export type VertexAssignee = {
  kind: 'agent' | 'human' | 'hermes-profile' | 'console'
  id: string
  name: string
  /** Two-letter fallback the UI renders when there is no avatar. */
  initials: string
  avatarUrl?: string
}

export type VertexSubtask = {
  id: string
  title: string
  done: boolean
}

export type VertexTaskFile = {
  id: string
  name: string
  /** Local path or remote URL. Never a credential-bearing URL. */
  url?: string
}

/** An image the operator attached to a card (a screenshot from the Board's
 * report dialog). Only the main process writes these: the file lives under
 * `<userData>/vertex-attachments/<taskId>/<id>.<ext>` and `path` is the
 * absolute location agents read it from. */
export type VertexTaskAttachment = {
  id: string
  name: string
  path: string
  mime: VertexTaskAttachmentMime
  bytes: number
  createdAt: number
  /** 'proof' when an agent attached it as evidence of finished work; absent
   * or 'screenshot' for everything else. */
  kind?: VertexTaskAttachmentKind
  /** Who attached it (an agent's --by, or 'carson' from the detail panel). */
  addedBy?: string
}

export const VERTEX_TASK_ATTACHMENT_KINDS = ['proof', 'screenshot'] as const
export type VertexTaskAttachmentKind = (typeof VERTEX_TASK_ATTACHMENT_KINDS)[number]

export function isVertexTaskAttachmentKind(value: unknown): value is VertexTaskAttachmentKind {
  return typeof value === 'string' && (VERTEX_TASK_ATTACHMENT_KINDS as readonly string[]).includes(value)
}

/** Proof images a single `tasks complete --proof` may carry. */
export const VERTEX_TASK_PROOF_MAX = 3

export const VERTEX_TASK_ATTACHMENT_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
} as const

export type VertexTaskAttachmentMime = keyof typeof VERTEX_TASK_ATTACHMENT_EXT

export const VERTEX_TASK_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024
export const VERTEX_TASK_ATTACHMENTS_MAX = 10

export function isVertexTaskAttachmentMime(value: unknown): value is VertexTaskAttachmentMime {
  // Why: `in` would accept inherited keys like 'constructor'.
  return typeof value === 'string' && Object.hasOwn(VERTEX_TASK_ATTACHMENT_EXT, value)
}

/** What the renderer hands main to attach an image; main picks the id, the
 * extension and the path itself. */
export type VertexTaskAttachmentInput = {
  name: string
  mime: string
  dataBase64: string
  kind?: VertexTaskAttachmentKind
  addedBy?: string
}

/** The image format a byte buffer really is, from its magic bytes; null when
 * it is none of the allowlisted formats, whatever the file name claims. */
export function sniffVertexTaskAttachmentMime(bytes: Uint8Array): VertexTaskAttachmentMime | null {
  const at = (i: number): number => bytes[i] ?? -1
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 && at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a) {
    return 'image/png'
  }
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) {
    return 'image/jpeg'
  }
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38 && (at(4) === 0x37 || at(4) === 0x39) && at(5) === 0x61) {
    return 'image/gif'
  }
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) {
    return 'image/webp'
  }
  return null
}

/** Attempts a task gets before the dispatcher dead-letters it. Shared so the
 *  store's crash recovery ends a spent task the same way a failed run does. */
export const VERTEX_DISPATCH_MAX_ATTEMPTS = 2

/** What the dispatcher has done with this task.
 *
 * Lives ON the task rather than in a side ledger so the board can show it:
 * "assigned" with no visible progress was the exact thing that made the old
 * flow untrustworthy. `attempts` drives dead-lettering after repeated failure. */
export type VertexTaskDispatch = {
  status: 'running' | 'succeeded' | 'failed' | 'dead'
  agentId: string
  agentName: string
  runId?: string
  attempts: number
  /** Main process that holds a 'running' claim. Stamped by the store, never
   *  by the renderer, so a claim whose process died can be told apart from
   *  one another live instance (dev builds share userData) is still running. */
  ownerPid?: number
  ownerSessionId?: string
  /** Window whose dispatcher holds the claim, stamped by main from the IPC
   *  sender, so that window can report which of its claims it still awaits. */
  ownerWebContentsId?: number
  updatedAt: number
  /** Failure summary, surfaced in the UI. Never a stack trace. */
  error?: string
  /** What the run actually billed. Recorded because the budget option is a
   *  trigger rather than a hard ceiling — an observed run billed $0.76
   *  against a $0.50 cap. */
  costUsd?: number | null
  /** The agent's own closing message, shown on the task so there is something
   *  to read besides a status dot. */
  report?: string
}

export type VertexTaskLink = {
  id: string
  label: string
}

/** How long a claim stays valid without a heartbeat before it is reaped. */
export const DEFAULT_LEASE_MS = 15 * 60 * 1000

/** A live claim on a card by a lead or worker. Set only by the store's
 * claim(); a card with a lease is never auto-dispatched. */
export type VertexTaskLease = {
  claimedBy: string
  kind: 'lead' | 'worker'
  claimedAt: number
  heartbeatAt: number
  leaseUntil: number
  note?: string
}

/** Free text by a person, lead or worker. UNTRUSTED: rendered as plain text,
 * never as markdown or HTML, never interpolated into a prompt. */
export type VertexTaskComment = {
  id: string
  author: string
  body: string
  createdAt: number
}

export type VertexTaskSourceOrigin = 'telegram' | 'gmail' | 'imessage' | 'asana' | 'manual'

/** The original message a card was made from, verbatim. UNTRUSTED DATA: it is
 * quoted to the operator and never followed as instructions. */
export type VertexTaskSourceQuote = {
  origin: VertexTaskSourceOrigin
  sender?: string
  receivedAt?: number
  text: string
}

export type VertexTaskRefusal = 'not-found' | 'not-ready' | `held-by:${string}`

/** Outcome of a work-board operation (claim, heartbeat, complete, block,
 * release). A refusal is a normal result, not an error: two agents racing
 * for a card is expected, and exactly one of them gets `ok: true`. */
export type VertexTaskOpResult =
  | { ok: true; task: VertexTask }
  | { ok: false; reason: VertexTaskRefusal }

export type VertexTaskOrigin = {
  kind: 'user' | 'agent' | 'manual'
  name: string
  /** Short source note, never a raw sensitive transcript. */
  note?: string
  createdAt: number
}

export type VertexTask = {
  id: string
  title: string
  description: string
  status: VertexTaskStatus
  priority: VertexTaskPriority
  type: VertexTaskType
  /** Where this task is routed. Defaults to 'system'. */
  destination: VertexTaskDestination
  /** Rank within a column. Sparse on purpose — see reindex() in the store. */
  order: number
  coverImageUrl?: string
  assignee?: VertexAssignee
  collaborators: VertexAssignee[]
  /** ISO-8601 date, day precision. */
  dueDate?: string
  labels: string[]
  related: VertexTaskLink[]
  /** Ids of other Vertex tasks this one waits on. */
  dependencies: string[]
  /** Parent task created from user intake or an agent handoff. */
  parentTaskId?: string
  /** Real child task ids created by agents or operators from this task. */
  childTaskIds: string[]
  subtasks: VertexSubtask[]
  files: VertexTaskFile[]
  /** Required before a task can enter Done. */
  resultNote?: string
  completedAt?: number
  /** Who or what created this task inside the system. */
  origin?: VertexTaskOrigin
  /** Set by the auto-mode dispatcher; absent means never dispatched. */
  dispatch?: VertexTaskDispatch
  /** Forward seam for Missions (an objective that spawns many tasks). Missions
   * have no store yet; carrying the id now avoids a migration later. */
  missionId?: string
  /** Which Vertex project owns this task. */
  projectId?: string
  /** Live claim by a lead or worker; absent when nobody holds the card. */
  lease?: VertexTaskLease
  /** Why a lead parked the card for the operator. Cleared when it leaves Blocked. */
  blockedReason?: string
  comments?: VertexTaskComment[]
  /** Verbatim original message. Untrusted; see VertexTaskSourceQuote. */
  sourceQuote?: VertexTaskSourceQuote
  /** Free-form id of whoever created the card (e.g. 'adam', a CLI user). */
  createdBy?: string
  /** Structured data a worker attaches on complete (PR url, files, ...). */
  resultMetadata?: Record<string, unknown>
  /** Images written by main through vertexTasks:addAttachment; absent when none. */
  attachments?: VertexTaskAttachment[]
  createdAt: number
  updatedAt: number
}

export type VertexTaskInput = {
  title: string
  status?: VertexTaskStatus
  description?: string
  priority?: VertexTaskPriority
  type?: VertexTaskType
  destination?: VertexTaskDestination
  assignee?: VertexAssignee
  parentTaskId?: string
  origin?: Omit<VertexTaskOrigin, 'createdAt'> & { createdAt?: number }
  projectId?: string
  missionId?: string
  labels?: string[]
  sourceQuote?: VertexTaskSourceQuote
  createdBy?: string
}

export type VertexTaskClaimInput = {
  by: string
  kind: VertexTaskLease['kind']
  leaseMs?: number
}

export type VertexTaskCompleteInput = {
  by: string
  resultNote: string
  metadata?: Record<string, unknown>
  /** Complete a card someone else holds (or nobody holds). Operator use. */
  force?: boolean
}

export type VertexTaskListFilter = {
  status?: VertexTaskStatus
  assigneeId?: string
  projectId?: string
  parentTaskId?: string
  claimedBy?: string
}

/** Every field a caller may change. `id`, `createdAt` and `order` are excluded:
 * identity is immutable, and ordering only ever changes through move(). */
export type VertexTaskPatch = Partial<
  Omit<VertexTask, 'id' | 'createdAt' | 'updatedAt' | 'order'>
>

/**
 * The single seam between the Kanban UI and storage.
 *
 * The renderer depends on this shape and nothing else, so the in-memory mock
 * it is being built against can be swapped for the real store with no
 * component changes.
 */
export type VertexTaskSource = {
  list(): VertexTask[]
  /** Force a fresh read from persistent storage, bypassing any in-memory cache. */
  reload?(): VertexTask[]
  create(input: VertexTaskInput): VertexTask
  update(taskId: string, patch: VertexTaskPatch): VertexTask | null
  /** Move a task to `to`, inserted at `toIndex` among that column's tasks. */
  move(taskId: string, to: VertexTaskStatus, toIndex: number): VertexTask | null
  remove(taskId: string): boolean
}

/** The store as the work board leads and workers drive through the CLI.
 * A superset of VertexTaskSource so the Kanban UI keeps its narrow seam. */
export type VertexWorkBoard = VertexTaskSource & {
  /** Compare-and-set: succeeds only for a To Do card with no live lease. */
  claim(taskId: string, input: VertexTaskClaimInput): VertexTaskOpResult
  heartbeat(taskId: string, by: string, note?: string): VertexTaskOpResult
  complete(taskId: string, input: VertexTaskCompleteInput): VertexTaskOpResult
  block(taskId: string, by: string, reason: string): VertexTaskOpResult
  release(taskId: string, by: string): VertexTaskOpResult
  comment(taskId: string, author: string, body: string): VertexTask | null
  /** Filtered list; expired leases are reaped first, same as list(). */
  listFiltered(filter: VertexTaskListFilter): VertexTask[]
}

export function isVertexTaskStatus(value: unknown): value is VertexTaskStatus {
  return VERTEX_TASK_STATUSES.includes(value as VertexTaskStatus)
}

export function isVertexTaskPriority(value: unknown): value is VertexTaskPriority {
  return VERTEX_TASK_PRIORITIES.includes(value as VertexTaskPriority)
}

export function isVertexTaskType(value: unknown): value is VertexTaskType {
  return VERTEX_TASK_TYPES.includes(value as VertexTaskType)
}

export function isVertexTaskDestination(value: unknown): value is VertexTaskDestination {
  return VERTEX_TASK_DESTINATIONS.includes(value as VertexTaskDestination)
}
