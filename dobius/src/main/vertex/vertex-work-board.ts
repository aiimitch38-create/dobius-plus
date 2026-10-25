/* The Kanban store as the work board for Hermes leads and worker consoles.
 *
 * Split from vertex-task-store.ts only for size: these methods run inside the
 * same synchronous read-modify-write, so a claim is a true compare-and-set
 * (two racing claims serialize, and the second one reads the first one's
 * lease). The store hands over its primitives through WorkBoardIo. */

import { randomUUID } from 'node:crypto'

import {
  DEFAULT_LEASE_MS,
  type VertexTask,
  type VertexTaskClaimInput,
  type VertexTaskCompleteInput,
  type VertexTaskListFilter,
  type VertexTaskOpResult,
  type VertexTaskRefusal,
  type VertexTaskStatus,
  type VertexWorkBoard
} from '../../shared/vertex-task-types'

export type WorkBoardIo = {
  /** Raw rows; throws when the file is unreadable. */
  readAll(): VertexTask[]
  /** Rows with orphaned dispatch claims already released. */
  readRecovered(): VertexTask[]
  persist(tasks: VertexTask[]): void
  columnOf(tasks: VertexTask[], status: VertexTaskStatus): VertexTask[]
  orderGap: number
}

export type WorkBoardMethods = Pick<
  VertexWorkBoard,
  'claim' | 'heartbeat' | 'complete' | 'block' | 'release' | 'comment' | 'listFiltered'
> & {
  /** The store's read with expired leases reaped (and saved) first. */
  readReaping(): VertexTask[]
}

/** Longest comment kept, so a runaway worker cannot bloat the board file. */
const COMMENT_MAX_CHARS = 4000

function addComment(task: VertexTask, author: string, body: string, now: number): void {
  const comments = Array.isArray(task.comments) ? task.comments : []
  comments.push({
    id: randomUUID(),
    author: author.trim().slice(0, 200),
    body: body.slice(0, COMMENT_MAX_CHARS),
    createdAt: now
  })
  task.comments = comments
}

/** Put a task at the end of `status` the same way update() does on a status change. */
function appendToColumn(
  io: WorkBoardIo,
  tasks: VertexTask[],
  task: VertexTask,
  status: VertexTaskStatus
): void {
  const column = io.columnOf(tasks, status).filter((t) => t.id !== task.id)
  task.status = status
  task.order = (column.at(-1)?.order ?? 0) + io.orderGap
}

function hasLiveLease(task: VertexTask, now: number): boolean {
  return Boolean(task.lease && task.lease.leaseUntil > now)
}

/* An expired lease means the holder stopped heartbeating (crashed, killed,
 * lost its console). The card goes back to To Do so another claim can win it;
 * a card the operator has since moved elsewhere only loses the stale lease. */
function reapExpiredLeases(io: WorkBoardIo, tasks: VertexTask[], now: number): boolean {
  let changed = false
  for (const task of tasks) {
    if (!task.lease || task.lease.leaseUntil > now) {
      continue
    }
    const holder = task.lease.claimedBy
    delete task.lease
    if (task.status === 'in-progress') {
      appendToColumn(io, tasks, task, 'todo')
    }
    addComment(task, 'system', `Lease held by ${holder} expired; back to To Do.`, now)
    task.updatedAt = now
    changed = true
  }
  return changed
}

function refuse(reason: VertexTaskRefusal): VertexTaskOpResult {
  return { ok: false, reason }
}

export function createWorkBoard(io: WorkBoardIo): WorkBoardMethods {
  function readReaping(): VertexTask[] {
    const tasks = io.readRecovered()
    if (reapExpiredLeases(io, tasks, Date.now())) {
      io.persist(tasks)
    }
    return tasks
  }

  return {
    readReaping,

    listFiltered(filter: VertexTaskListFilter): VertexTask[] {
      return [...readReaping()]
        .sort((a, b) => a.order - b.order)
        .filter(
          (task) =>
            (!filter.status || task.status === filter.status) &&
            (!filter.assigneeId || task.assignee?.id === filter.assigneeId) &&
            (!filter.projectId || task.projectId === filter.projectId) &&
            (!filter.parentTaskId || task.parentTaskId === filter.parentTaskId) &&
            (!filter.claimedBy || task.lease?.claimedBy === filter.claimedBy)
        )
    },

    /* Compare-and-set. The store is synchronous read-modify-write in main, so
     * two claims can never interleave: the second one reads the first one's
     * lease and is refused. */
    claim(taskId: string, input: VertexTaskClaimInput): VertexTaskOpResult {
      const by = input.by.trim()
      if (!by) {
        throw new Error('claim needs --by')
      }
      const tasks = [...io.readAll()]
      const now = Date.now()
      const reaped = reapExpiredLeases(io, tasks, now)
      const task = tasks.find((t) => t.id === taskId)
      if (!task) {
        if (reaped) {
          io.persist(tasks)
        }
        return refuse('not-found')
      }
      if (hasLiveLease(task, now)) {
        if (reaped) {
          io.persist(tasks)
        }
        return refuse(`held-by:${task.lease?.claimedBy}`)
      }
      if (task.status !== 'todo') {
        if (reaped) {
          io.persist(tasks)
        }
        return refuse('not-ready')
      }
      const leaseMs =
        typeof input.leaseMs === 'number' && Number.isFinite(input.leaseMs) && input.leaseMs > 0
          ? Math.trunc(input.leaseMs)
          : DEFAULT_LEASE_MS
      task.lease = {
        claimedBy: by,
        kind: input.kind === 'lead' ? 'lead' : 'worker',
        claimedAt: now,
        heartbeatAt: now,
        leaseUntil: now + leaseMs
      }
      appendToColumn(io, tasks, task, 'in-progress')
      addComment(task, 'system', `Claimed by ${by} (${task.lease.kind}).`, now)
      task.updatedAt = now
      io.persist(tasks)
      return { ok: true, task }
    },

    heartbeat(taskId: string, by: string, note?: string): VertexTaskOpResult {
      const tasks = [...io.readAll()]
      const now = Date.now()
      const task = tasks.find((t) => t.id === taskId)
      if (!task) {
        return refuse('not-found')
      }
      if (!hasLiveLease(task, now) || !task.lease) {
        return refuse('not-ready')
      }
      if (task.lease.claimedBy !== by.trim()) {
        return refuse(`held-by:${task.lease.claimedBy}`)
      }
      // Why: the lease length is not stored; the previous window's span is it.
      const leaseMs = Math.max(1, task.lease.leaseUntil - task.lease.heartbeatAt)
      task.lease = {
        ...task.lease,
        heartbeatAt: now,
        leaseUntil: now + leaseMs,
        note: typeof note === 'string' && note.trim() ? note.trim().slice(0, 500) : task.lease.note
      }
      task.updatedAt = now
      io.persist(tasks)
      return { ok: true, task }
    },

    complete(taskId: string, input: VertexTaskCompleteInput): VertexTaskOpResult {
      const by = input.by.trim()
      const resultNote = input.resultNote?.trim()
      if (!resultNote) {
        // Same rule update() enforces for Done, surfaced as an error so the CLI
        // says why instead of a silent null.
        throw new Error('A result note is required to complete a task')
      }
      const tasks = [...io.readAll()]
      const now = Date.now()
      const task = tasks.find((t) => t.id === taskId)
      if (!task) {
        return refuse('not-found')
      }
      const live = hasLiveLease(task, now) ? task.lease : undefined
      if (!input.force) {
        if (live && live.claimedBy !== by) {
          return refuse(`held-by:${live.claimedBy}`)
        }
        if (!live) {
          return refuse('not-ready')
        }
      }
      delete task.lease
      delete task.blockedReason
      task.resultNote = resultNote
      task.resultMetadata = input.metadata
      task.completedAt = now
      appendToColumn(io, tasks, task, 'done')
      const forced = Boolean(input.force) && (!live || live.claimedBy !== by)
      addComment(
        task,
        by || 'operator',
        forced ? `Completed (forced): ${resultNote}` : `Completed: ${resultNote}`,
        now
      )
      task.updatedAt = now
      io.persist(tasks)
      return { ok: true, task }
    },

    block(taskId: string, by: string, reason: string): VertexTaskOpResult {
      const tasks = [...io.readAll()]
      const now = Date.now()
      const task = tasks.find((t) => t.id === taskId)
      if (!task) {
        return refuse('not-found')
      }
      const live = hasLiveLease(task, now) ? task.lease : undefined
      if (live && live.claimedBy !== by.trim()) {
        return refuse(`held-by:${live.claimedBy}`)
      }
      // Why the lease is dropped: a blocked card waits for the operator, and a
      // lease left on it would expire and bounce the card back to To Do.
      delete task.lease
      task.blockedReason = reason.trim().slice(0, 1000)
      appendToColumn(io, tasks, task, 'blocked')
      addComment(task, by.trim() || 'operator', `Blocked: ${task.blockedReason}`, now)
      task.updatedAt = now
      io.persist(tasks)
      return { ok: true, task }
    },

    release(taskId: string, by: string): VertexTaskOpResult {
      const tasks = [...io.readAll()]
      const now = Date.now()
      const task = tasks.find((t) => t.id === taskId)
      if (!task) {
        return refuse('not-found')
      }
      if (!hasLiveLease(task, now) || !task.lease) {
        return refuse('not-ready')
      }
      if (task.lease.claimedBy !== by.trim()) {
        return refuse(`held-by:${task.lease.claimedBy}`)
      }
      delete task.lease
      appendToColumn(io, tasks, task, 'todo')
      addComment(task, by.trim(), 'Released; back to To Do.', now)
      task.updatedAt = now
      io.persist(tasks)
      return { ok: true, task }
    },

    comment(taskId: string, author: string, body: string): VertexTask | null {
      if (!author.trim() || !body.trim()) {
        return null
      }
      const tasks = [...io.readAll()]
      const task = tasks.find((t) => t.id === taskId)
      if (!task) {
        return null
      }
      const now = Date.now()
      addComment(task, author, body, now)
      task.updatedAt = now
      io.persist(tasks)
      return task
    }
  }
}
