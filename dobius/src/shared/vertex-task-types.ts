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

export type VertexTaskStatus = 'backlog' | 'todo' | 'in-progress' | 'review' | 'testing' | 'done'

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
 * an unassigned task is normal. */
export type VertexAssignee = {
  kind: 'agent' | 'human'
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
  updatedAt: number
  /** Failure summary, surfaced in the UI. Never a stack trace. */
  error?: string
  /** The agent's own closing message, shown on the task so there is something
   *  to read besides a status dot. */
  report?: string
}

export type VertexTaskLink = {
  id: string
  label: string
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
  subtasks: VertexSubtask[]
  files: VertexTaskFile[]
  commentCount: number
  /** Set by the auto-mode dispatcher; absent means never dispatched. */
  dispatch?: VertexTaskDispatch
  /** Forward seam for Missions (an objective that spawns many tasks). Missions
   * have no store yet; carrying the id now avoids a migration later. */
  missionId?: string
  /** Which Vertex project owns this task. */
  projectId?: string
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
  projectId?: string
  missionId?: string
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
  create(input: VertexTaskInput): VertexTask
  update(taskId: string, patch: VertexTaskPatch): VertexTask | null
  /** Move a task to `to`, inserted at `toIndex` among that column's tasks. */
  move(taskId: string, to: VertexTaskStatus, toIndex: number): VertexTask | null
  remove(taskId: string): boolean
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
