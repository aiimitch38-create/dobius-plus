/* Persistence for Vertex-owned tasks.
 *
 * Follows the same shape as communications/team-store.ts: a JSON file in
 * userData behind SafeJsonFile (in-memory cache, atomic temp + rename write).
 * An unreadable file makes the board read-only: every call throws instead of
 * showing an empty board that the next save would write over the real one.
 * Deliberately not SQLite — a Kanban holds hundreds of rows, not millions,
 * and adding a schema plus migrations would buy nothing here.
 *
 * Ordering: tasks carry a sparse `order` within their column, spaced by
 * ORDER_GAP. A move usually just picks a midpoint between neighbours, so no
 * other row is touched. Only when the gap closes does the column reindex. */

import { randomUUID } from 'node:crypto'
import path from 'node:path'

import {
  isVertexTaskPriority,
  isVertexTaskDestination,
  isVertexTaskStatus,
  isVertexTaskType,
  type VertexTask,
  type VertexTaskInput,
  type VertexTaskPatch,
  type VertexTaskStatus,
  type VertexWorkBoard,
} from '../../shared/vertex-task-types'
import { SafeJsonFile } from '../storage/safe-json-file'
import { readReleasingOrphanedClaims, stampClaimOwner } from './vertex-dispatch-recovery'
import { normalizeAgentPerson } from './vertex-task-normalize'
import { removeVertexTaskAttachmentDir } from './vertex-attachment-paths'
import { createWorkBoard } from './vertex-work-board'
import { getUserDataRoot } from '../storage/user-data-root'

const FILE_NAME = 'vertex-tasks.json'
const ORDER_GAP = 1000

/** Overridable so tests do not touch the real userData directory. */
let storageDirOverride: string | null = null
let file = createFile()

export function setVertexTaskStorageDir(dir: string | null): void {
  storageDirOverride = dir
  file = createFile()
}

function storageDir(): string {
  return storageDirOverride ?? getUserDataRoot()
}

function filePath(): string {
  return path.join(storageDir(), FILE_NAME)
}

function createFile(): SafeJsonFile<VertexTask[]> {
  return new SafeJsonFile<VertexTask[]>({
    filePath,
    // Why all-or-nothing: a dropped row would be erased by the next save, so
    // one bad row makes the whole file unreadable (read-only + quarantine).
    parse: (raw) =>
      Array.isArray(raw) && raw.every(isUsableTask) ? raw.map(normalizePersistedTask) : undefined,
    fallback: () => [],
    label: `[vertex] ${FILE_NAME}`,
  })
}

function readAll(): VertexTask[] {
  const tasks = file.get()
  const { status, detail } = file.getStatus()
  if (status === 'unreadable') {
    throw new Error(
      `The Kanban board file ${filePath()} could not be read (${detail}). The board is read-only until the file is fixed or removed.`,
    )
  }
  return tasks
}

function normalizePersistedTask(task: VertexTask): VertexTask {
  const assignee = normalizeAgentPerson(task.assignee)
  const collaborators = Array.isArray(task.collaborators)
    ? task.collaborators
        .map(normalizeAgentPerson)
        .filter((person): person is NonNullable<VertexTask['assignee']> => person !== undefined)
    : []
  return {
    // Why defaulted on read: records written before `destination` existed have
    // none, and a missing value must not read as Asana.
    ...task,
    destination: isVertexTaskDestination(task.destination) ? task.destination : 'system',
    assignee,
    collaborators,
    labels: Array.isArray(task.labels) ? task.labels : [],
    related: Array.isArray(task.related) ? task.related : [],
    dependencies: Array.isArray(task.dependencies) ? task.dependencies : [],
    subtasks: Array.isArray(task.subtasks) ? task.subtasks : [],
    files: Array.isArray(task.files) ? task.files : [],
    childTaskIds: Array.isArray(task.childTaskIds)
      ? task.childTaskIds.filter((id): id is string => typeof id === 'string')
      : [],
    dispatch:
      task.dispatch && assignee?.kind === 'agent'
        ? { ...task.dispatch, agentId: assignee.id, agentName: assignee.name }
        : task.dispatch,
  }
}

export function reloadVertexTasksFromDisk(): VertexTask[] {
  file.invalidate()
  return readReleasingOrphanedClaims(readAll, persist, ORDER_GAP)
}


/** Drop rows that would crash a renderer rather than trusting the file. */
function isUsableTask(value: unknown): value is VertexTask {
  if (!value || typeof value !== 'object') {
    return false
  }
  const t = value as Partial<VertexTask>
  return (
    typeof t.id === 'string' &&
    typeof t.title === 'string' &&
    isVertexTaskStatus(t.status) &&
    typeof t.order === 'number'
  )
}

function persist(tasks: VertexTask[]): void {
  if (!file.set(tasks)) {
    // Why: set() keeps the unsaved value (and callers mutate cached rows in
    // place), so drop the cache to show what is really on disk.
    file.invalidate()
    throw new Error(`The Kanban board could not be saved to ${filePath()}.`)
  }
}

function columnOf(tasks: VertexTask[], status: VertexTaskStatus): VertexTask[] {
  return tasks.filter((t) => t.status === status).sort((a, b) => a.order - b.order)
}

/** Re-space a column's order values. Only called when two neighbours collide. */
function reindex(tasks: VertexTask[], status: VertexTaskStatus): void {
  columnOf(tasks, status).forEach((task, i) => {
    task.order = (i + 1) * ORDER_GAP
  })
}

function normalizeInput(input: VertexTaskInput): VertexTask {
  const now = Date.now()
  return {
    id: randomUUID(),
    title: input.title.trim(),
    description: input.description ?? '',
    status: isVertexTaskStatus(input.status) ? input.status : 'backlog',
    priority: isVertexTaskPriority(input.priority) ? input.priority : 'medium',
    type: isVertexTaskType(input.type) ? input.type : 'feature',
    destination: isVertexTaskDestination(input.destination) ? input.destination : 'system',
    order: 0,
    assignee: input.assignee,
    collaborators: [],
    labels: Array.isArray(input.labels)
      ? input.labels.filter((label): label is string => typeof label === 'string' && !!label.trim())
      : [],
    related: [],
    dependencies: [],
    parentTaskId: input.parentTaskId,
    childTaskIds: [],
    subtasks: [],
    files: [],
    origin: input.origin
      ? {
          ...input.origin,
          createdAt: typeof input.origin.createdAt === 'number' ? input.origin.createdAt : now,
        }
      : undefined,
    missionId: input.missionId,
    projectId: input.projectId,
    sourceQuote: input.sourceQuote,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  }
}

// Why a factory: the work-board methods live in their own module (file size),
// and handing them the store's primitives avoids a circular import.
const workBoard = createWorkBoard({
  readAll,
  readRecovered: () => readReleasingOrphanedClaims(readAll, persist, ORDER_GAP),
  persist,
  columnOf,
  orderGap: ORDER_GAP,
})

export const vertexTaskStore: VertexWorkBoard = {
  ...workBoard,

  list(): VertexTask[] {
    // Sorted so every caller sees the same order without re-sorting.
    return [...workBoard.readReaping()].sort((a, b) => a.order - b.order)
  },

  create(input: VertexTaskInput): VertexTask {
    if (!input.title?.trim()) {
      throw new Error('A task needs a title')
    }
    const tasks = [...readAll()]
    const task = normalizeInput(input)
    const column = columnOf(tasks, task.status)
    const last = column.at(-1)
    task.order = (last?.order ?? 0) + ORDER_GAP
    tasks.push(task)
    if (task.parentTaskId) {
      const parent = tasks.find((t) => t.id === task.parentTaskId)
      if (parent && !parent.childTaskIds.includes(task.id)) {
        parent.childTaskIds.push(task.id)
        parent.updatedAt = task.updatedAt
      }
    }
    persist(tasks)
    return task
  },

  update(taskId: string, patch: VertexTaskPatch): VertexTask | null {
    const tasks = [...readAll()]
    const task = tasks.find((t) => t.id === taskId)
    if (!task) {
      return null
    }

    if ((patch.status ?? task.status) === 'done') {
      const resultNote = (patch.resultNote ?? task.resultNote)?.trim()
      if (!resultNote) {
        return null
      }
      patch.resultNote = resultNote
      patch.completedAt = patch.completedAt ?? task.completedAt ?? Date.now()
    }

    // Status is intentionally patchable: the detail panel changes it directly.
    // Landing at the end of the destination column matches what a user sees.
    if (patch.status && patch.status !== task.status && isVertexTaskStatus(patch.status)) {
      const column = columnOf(tasks, patch.status)
      task.order = (column.at(-1)?.order ?? 0) + ORDER_GAP
    }

    if (patch.parentTaskId === task.id) {
      delete patch.parentTaskId
    }
    // Why: the reason belongs to the Blocked column; the operator moving the
    // card on is the unblock, and a stale reason would still show on the chip.
    if (patch.status && patch.status !== 'blocked' && task.blockedReason) {
      delete task.blockedReason
    }
    // Why: a lease belongs to In Progress; a card the operator drags out of
    // that column is no longer held, or claim() would refuse it as held-by.
    if (patch.status && patch.status !== 'in-progress' && task.lease) {
      delete task.lease
    }
    // Why: only claim()/heartbeat() may set a lease; a plain patch must not re-add one.
    delete patch.lease
    stampClaimOwner(patch)
    const oldParentId = task.parentTaskId
    Object.assign(task, patch, { updatedAt: Date.now() })
    if ('parentTaskId' in patch) {
      // Why: re-parenting must move the id between both parents' child lists
      // in this same write, or the old parent keeps a stale child.
      task.parentTaskId = patch.parentTaskId || undefined
      if (oldParentId !== task.parentTaskId) {
        const oldParent = tasks.find((t) => t.id === oldParentId)
        if (oldParent?.childTaskIds.includes(task.id)) {
          oldParent.childTaskIds = oldParent.childTaskIds.filter((id) => id !== task.id)
          oldParent.updatedAt = task.updatedAt
        }
      }
      const parent = tasks.find((t) => t.id === task.parentTaskId)
      if (parent && !parent.childTaskIds.includes(task.id)) {
        parent.childTaskIds.push(task.id)
        parent.updatedAt = task.updatedAt
      }
    }
    persist(tasks)
    return task
  },

  move(taskId: string, to: VertexTaskStatus, toIndex: number): VertexTask | null {
    if (!isVertexTaskStatus(to)) {
      return null
    }
    const tasks = [...readAll()]
    const task = tasks.find((t) => t.id === taskId)
    if (!task) {
      return null
    }
    if (to === 'done' && !task.resultNote?.trim()) {
      return null
    }

    task.status = to
    if (to !== 'blocked') {
      delete task.blockedReason
    }
    if (to !== 'in-progress') {
      delete task.lease
    }
    const column = columnOf(tasks, to).filter((t) => t.id !== taskId)
    const index = Math.max(0, Math.min(toIndex, column.length))
    const before = column[index - 1]
    const after = column[index]

    if (!before && !after) {
      task.order = ORDER_GAP
    } else if (!before) {
      task.order = after.order - ORDER_GAP
    } else if (!after) {
      task.order = before.order + ORDER_GAP
    } else {
      task.order = (before.order + after.order) / 2
      // Gap exhausted (orders became adjacent or equal) — re-space the column.
      if (task.order === before.order || task.order === after.order) {
        task.order = before.order + 1
        reindex(tasks, to)
      }
    }

    task.updatedAt = Date.now()
    if (to === 'done') {
      task.completedAt = task.completedAt ?? task.updatedAt
    }
    persist(tasks)
    return task
  },

  remove(taskId: string): boolean {
    const tasks = readAll()
    if (!tasks.some((t) => t.id === taskId)) {
      return false
    }
    const now = Date.now()
    // Unlink the removed task from parents, children and dependents in the
    // same write, so no row is left pointing at an id that no longer exists.
    const next = tasks
      .filter((t) => t.id !== taskId)
      .map((t) => {
        const linked =
          t.parentTaskId === taskId ||
          t.childTaskIds.includes(taskId) ||
          t.dependencies.includes(taskId)
        if (!linked) {
          return t
        }
        return {
          ...t,
          parentTaskId: t.parentTaskId === taskId ? undefined : t.parentTaskId,
          childTaskIds: t.childTaskIds.filter((id) => id !== taskId),
          dependencies: t.dependencies.filter((id) => id !== taskId),
          updatedAt: now,
        }
      })
    persist(next)
    removeVertexTaskAttachmentDir(taskId)
    return true
  },
}
