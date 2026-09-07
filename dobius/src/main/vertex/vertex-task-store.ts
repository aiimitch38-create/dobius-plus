/* Persistence for Vertex-owned tasks.
 *
 * Follows the same shape as communications/team-store.ts: a JSON file in
 * userData, an in-memory cache, and an atomic write (temp file + rename) so a
 * crash mid-write cannot leave a truncated file. Deliberately not SQLite —
 * a Kanban holds hundreds of rows, not millions, and adding a schema plus
 * migrations would buy nothing here.
 *
 * Ordering: tasks carry a sparse `order` within their column, spaced by
 * ORDER_GAP. A move usually just picks a midpoint between neighbours, so no
 * other row is touched. Only when the gap closes does the column reindex. */

import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

import {
  isVertexTaskPriority,
  isVertexTaskDestination,
  isVertexTaskStatus,
  isVertexTaskType,
  type VertexTask,
  type VertexTaskInput,
  type VertexTaskPatch,
  type VertexTaskSource,
  type VertexTaskStatus,
} from '../../shared/vertex-task-types'
import { listAgents } from '../agents/agents-store'

const FILE_NAME = 'vertex-tasks.json'
const ORDER_GAP = 1000

let cached: VertexTask[] | null = null
/** Overridable so tests do not touch the real userData directory. */
let storageDirOverride: string | null = null

export function setVertexTaskStorageDir(dir: string | null): void {
  storageDirOverride = dir
  cached = null
}

function storageDir(): string {
  return storageDirOverride ?? app.getPath('userData')
}

function filePath(): string {
  return path.join(storageDir(), FILE_NAME)
}

function readAll(): VertexTask[] {
  if (cached) {
    return cached
  }
  const p = filePath()
  if (!existsSync(p)) {
    cached = []
    return cached
  }
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'))
    cached = Array.isArray(parsed)
      ? parsed.filter(isUsableTask).map(normalizePersistedTask)
      : []
  } catch {
    // Why swallow: a corrupt file must not stop the app from booting. Starting
    // empty is recoverable; refusing to launch is not.
    cached = []
  }
  return cached
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '??'
  const first = parts[0][0] ?? ''
  const second = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : (parts[0][1] ?? '')
  return `${first}${second}`.toUpperCase()
}

function normalizedKey(value: string): string {
  return value.trim().toLowerCase()
}

function normalizeAgentPerson(person: VertexTask['assignee']): VertexTask['assignee'] {
  if (person?.kind !== 'agent') return person
  const agents = listAgents()
  if (agents.some((agent) => agent.id === person.id)) return person
  const wanted = normalizedKey(person.name || person.id)
  const agent = agents.find(
    (candidate) =>
      normalizedKey(candidate.name) === wanted || normalizedKey(candidate.id) === wanted,
  )
  return agent
    ? { kind: 'agent', id: agent.id, name: agent.name, initials: initialsOf(agent.name) }
    : person
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
  cached = null
  return readAll()
}

/** Drop rows that would crash a renderer rather than trusting the file. */
function isUsableTask(value: unknown): value is VertexTask {
  if (!value || typeof value !== 'object') return false
  const t = value as Partial<VertexTask>
  return (
    typeof t.id === 'string' &&
    typeof t.title === 'string' &&
    isVertexTaskStatus(t.status) &&
    typeof t.order === 'number'
  )
}

function persist(tasks: VertexTask[]): void {
  const dir = storageDir()
  mkdirSync(dir, { recursive: true })
  const target = filePath()
  const tmp = `${target}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(tasks, null, 2), 'utf8')
  renameSync(tmp, target)
  cached = tasks
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
    labels: [],
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
    createdAt: now,
    updatedAt: now,
  }
}

export const vertexTaskStore: VertexTaskSource = {
  list(): VertexTask[] {
    // Sorted so every caller sees the same order without re-sorting.
    return [...readAll()].sort((a, b) => a.order - b.order)
  },

  create(input: VertexTaskInput): VertexTask {
    if (!input.title?.trim()) {
      throw new Error('A task needs a title')
    }
    const tasks = [...readAll()]
    const task = normalizeInput(input)
    const column = columnOf(tasks, task.status)
    const last = column[column.length - 1]
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
    if (!task) return null

    if ((patch.status ?? task.status) === 'done') {
      const resultNote = (patch.resultNote ?? task.resultNote)?.trim()
      if (!resultNote) return null
      patch.resultNote = resultNote
      patch.completedAt = patch.completedAt ?? task.completedAt ?? Date.now()
    }

    // Status is intentionally patchable: the detail panel changes it directly.
    // Landing at the end of the destination column matches what a user sees.
    if (patch.status && patch.status !== task.status && isVertexTaskStatus(patch.status)) {
      const column = columnOf(tasks, patch.status)
      task.order = (column[column.length - 1]?.order ?? 0) + ORDER_GAP
    }

    Object.assign(task, patch, { updatedAt: Date.now() })
    if (patch.parentTaskId && patch.parentTaskId !== task.id) {
      const parent = tasks.find((t) => t.id === patch.parentTaskId)
      if (parent && !parent.childTaskIds.includes(task.id)) {
        parent.childTaskIds.push(task.id)
        parent.updatedAt = task.updatedAt
      }
    }
    persist(tasks)
    return task
  },

  move(taskId: string, to: VertexTaskStatus, toIndex: number): VertexTask | null {
    if (!isVertexTaskStatus(to)) return null
    const tasks = [...readAll()]
    const task = tasks.find((t) => t.id === taskId)
    if (!task) return null
    if (to === 'done' && !task.resultNote?.trim()) {
      return null
    }

    task.status = to
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
    const next = tasks.filter((t) => t.id !== taskId)
    if (next.length === tasks.length) return false
    persist(next)
    return true
  },
}
