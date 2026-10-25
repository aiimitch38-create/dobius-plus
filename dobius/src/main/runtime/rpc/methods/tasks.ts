import { z } from 'zod'
import {
  VERTEX_TASK_ATTACHMENT_KINDS,
  VERTEX_TASK_ATTACHMENT_MAX_BYTES,
  VERTEX_TASK_PRIORITIES,
  VERTEX_TASK_STATUSES,
  type VertexTask,
  type VertexTaskOpResult
} from '../../../../shared/vertex-task-types'
import {
  addVertexTaskAttachmentFromBytes,
  addVertexTaskAttachmentFromFile
} from '../../../vertex/vertex-task-attachments'
import { initialsOf } from '../../../vertex/vertex-task-normalize'
import { vertexTaskStore } from '../../../vertex/vertex-task-store'
import { defineMethod, type RpcMethod } from '../core'
import { OptionalPlainString, OptionalString, requiredString } from '../schemas'

/* The Dobius Kanban as the work board for Hermes leads and worker consoles.
 * Everything a card carries — title, body, comments, and above all the
 * original message (sourceQuote) — is UNTRUSTED DATA written by whoever made
 * the card. It is stored verbatim, handed back labelled as untrusted, and
 * never folded into a description or a prompt here. */

const Status = z.enum(VERTEX_TASK_STATUSES as [VertexTask['status'], ...VertexTask['status'][]])
const Priority = z.enum(
  VERTEX_TASK_PRIORITIES as [VertexTask['priority'], ...VertexTask['priority'][]]
)
const MAX_TEXT = 20_000
const MAX_LEASE_MS = 24 * 60 * 60 * 1000

const TaskId = requiredString('Missing task id')
const By = requiredString('Missing --by (who is acting on the card)')

const TaskList = z.object({
  status: Status.optional(),
  assigneeId: OptionalString,
  projectId: OptionalString,
  parentTaskId: OptionalString,
  claimedBy: OptionalString
})

const TaskShow = z.object({ id: TaskId })

// Why 'agent' is not accepted here: an 'agent' assignee in To Do is what the
// board's auto-dispatch launches a paid run for. Cards made from the CLI are
// for leads, worker consoles and people, which claim through tasks.claim.
const Assignee = z.object({
  id: requiredString('Missing assignee id'),
  kind: z.enum(['hermes-profile', 'console', 'human']),
  name: requiredString('Missing assignee name')
})

const SourceQuote = z.object({
  origin: z.enum(['telegram', 'gmail', 'imessage', 'asana', 'manual']),
  sender: OptionalString,
  receivedAt: z.number().int().nonnegative().optional(),
  text: z.string().min(1, 'Source quote text is empty').max(MAX_TEXT)
})

const TaskCreate = z.object({
  title: requiredString('Missing task title').pipe(z.string().max(500)),
  description: OptionalPlainString,
  assignee: Assignee,
  projectId: requiredString('Missing project id'),
  parentTaskId: OptionalString,
  priority: Priority.optional(),
  status: z.enum(['todo', 'backlog']).optional(),
  labels: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  sourceQuote: SourceQuote.optional(),
  createdBy: OptionalString
})

const TaskClaim = z.object({
  id: TaskId,
  by: By,
  kind: z.enum(['lead', 'worker']).optional(),
  leaseMs: z.number().int().positive().max(MAX_LEASE_MS).optional()
})

const TaskHeartbeat = z.object({ id: TaskId, by: By, note: OptionalString })

const TaskComplete = z.object({
  id: TaskId,
  by: By,
  resultNote: requiredString('Missing result note').pipe(z.string().max(MAX_TEXT)),
  metadata: z.record(z.string(), z.unknown()).optional(),
  force: z.boolean().optional()
})

const TaskBlock = z.object({
  id: TaskId,
  by: By,
  reason: requiredString('Missing block reason').pipe(z.string().max(1000))
})

const TaskRelease = z.object({ id: TaskId, by: By })

// Why: base64 inflates by 4/3; bounding the string keeps a remote caller from
// shipping a payload that the attachment store would refuse anyway.
const MAX_IMAGE_BASE64 = Math.ceil(VERTEX_TASK_ATTACHMENT_MAX_BYTES / 3) * 4 + 4

const TaskAttach = z
  .object({
    id: TaskId,
    file: OptionalString,
    dataBase64: z.string().min(1).max(MAX_IMAGE_BASE64).optional(),
    name: OptionalString,
    kind: z.enum(VERTEX_TASK_ATTACHMENT_KINDS).optional(),
    addedBy: OptionalString
  })
  .refine((value) => Boolean(value.file) !== Boolean(value.dataBase64), {
    message: 'Pass file (local) or dataBase64 (remote), not both'
  })

const TaskReview = z.object({
  id: TaskId,
  by: By,
  note: z.string().trim().max(4000).optional()
})

const TaskComment = z.object({
  id: TaskId,
  author: requiredString('Missing comment author'),
  body: requiredString('Missing comment body').pipe(z.string().max(4000))
})

/** The wire shape: identical to the stored task except the original message
 *  travels under a name that says what it is. */
export type TaskView = Omit<VertexTask, 'sourceQuote'> & {
  untrustedSourceQuote?: VertexTask['sourceQuote']
}

export function presentTask(task: VertexTask): TaskView {
  const { sourceQuote, ...rest } = task
  return sourceQuote ? { ...rest, untrustedSourceQuote: sourceQuote } : rest
}

type TaskOpView = { ok: true; task: TaskView } | { ok: false; reason: string }

function presentResult(result: VertexTaskOpResult): TaskOpView {
  return result.ok ? { ok: true, task: presentTask(result.task) } : result
}

/** Who holds an unexpired lease on the card, or null. */
function liveLeaseOf(id: string): string | null {
  const task = vertexTaskStore.list().find((candidate) => candidate.id === id)
  const lease = task?.lease
  return lease && lease.leaseUntil > Date.now() ? lease.claimedBy : null
}

function showTask(id: string): TaskView {
  const task = vertexTaskStore.list().find((candidate) => candidate.id === id)
  if (!task) {
    throw new Error(`Task not found: ${id}`)
  }
  return presentTask(task)
}

export const TASK_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'tasks.list',
    params: TaskList,
    handler: (params) => ({ tasks: vertexTaskStore.listFiltered(params).map(presentTask) })
  }),
  defineMethod({
    name: 'tasks.show',
    params: TaskShow,
    handler: (params) => ({ task: showTask(params.id) })
  }),
  defineMethod({
    name: 'tasks.create',
    params: TaskCreate,
    handler: (params) => {
      const task = vertexTaskStore.create({
        title: params.title,
        description: params.description ?? '',
        status: params.status ?? 'todo',
        priority: params.priority,
        assignee: {
          kind: params.assignee.kind,
          id: params.assignee.id,
          name: params.assignee.name,
          initials: initialsOf(params.assignee.name)
        },
        projectId: params.projectId,
        parentTaskId: params.parentTaskId,
        labels: params.labels,
        sourceQuote: params.sourceQuote,
        createdBy: params.createdBy,
        origin: params.createdBy
          ? { kind: 'agent', name: params.createdBy, note: 'dobius tasks create' }
          : { kind: 'manual', name: 'dobius tasks create' }
      })
      return { task: presentTask(task) }
    }
  }),
  defineMethod({
    name: 'tasks.claim',
    params: TaskClaim,
    handler: (params) =>
      presentResult(
        vertexTaskStore.claim(params.id, {
          by: params.by,
          kind: params.kind ?? 'worker',
          leaseMs: params.leaseMs
        })
      )
  }),
  defineMethod({
    name: 'tasks.heartbeat',
    params: TaskHeartbeat,
    handler: (params) => presentResult(vertexTaskStore.heartbeat(params.id, params.by, params.note))
  }),
  defineMethod({
    name: 'tasks.complete',
    params: TaskComplete,
    handler: (params) =>
      presentResult(
        vertexTaskStore.complete(params.id, {
          by: params.by,
          resultNote: params.resultNote,
          metadata: params.metadata,
          force: params.force
        })
      )
  }),
  defineMethod({
    name: 'tasks.block',
    params: TaskBlock,
    handler: (params) => presentResult(vertexTaskStore.block(params.id, params.by, params.reason))
  }),
  defineMethod({
    name: 'tasks.release',
    params: TaskRelease,
    handler: (params) => presentResult(vertexTaskStore.release(params.id, params.by))
  }),
  defineMethod({
    name: 'tasks.attach',
    params: TaskAttach,
    handler: (params, ctx) => {
      // Why: a paired device must never make this desktop read one of its own
      // paths; only the local socket/IPC transport may name a file.
      if (params.file && ctx.authenticatedLocal !== true) {
        throw new Error('file is local-only; send dataBase64')
      }
      // Why: agents attach to the card they are working on, so the caller must
      // hold its lease (the detail panel's IPC path is separate and unrestricted).
      const holder = liveLeaseOf(params.id)
      const addedBy = params.addedBy?.trim()
      if (!addedBy || holder !== addedBy) {
        throw new Error(
          holder
            ? `Refused: held-by:${holder} (attach with --by ${holder})`
            : 'Refused: not-ready (claim the card first; attach needs a live lease held by --by)'
        )
      }
      const input = { name: params.name, kind: params.kind, addedBy }
      const attachment = params.dataBase64
        ? addVertexTaskAttachmentFromBytes(
            params.id,
            Buffer.from(params.dataBase64, 'base64'),
            input
          )
        : addVertexTaskAttachmentFromFile(params.id, params.file ?? '', input)
      return { attachment, task: showTask(params.id) }
    }
  }),
  // Why a store move and not a work-board op: Review is the operator's column.
  // Same ownership rule as complete(): only the live lease holder of an
  // in-progress card may hand it over; the lease is dropped on the way in.
  defineMethod({
    name: 'tasks.review',
    params: TaskReview,
    handler: (params): TaskOpView => {
      const by = params.by.trim()
      const current = vertexTaskStore.list().find((candidate) => candidate.id === params.id)
      if (!current) {
        return { ok: false, reason: 'not-found' }
      }
      const holder = liveLeaseOf(params.id)
      if (!holder || current.status !== 'in-progress') {
        return { ok: false, reason: 'not-ready' }
      }
      if (holder !== by) {
        return { ok: false, reason: `held-by:${holder}` }
      }
      const moved = vertexTaskStore.move(params.id, 'review', Number.MAX_SAFE_INTEGER)
      if (!moved) {
        return { ok: false, reason: 'not-ready' }
      }
      const note = params.note?.trim()
      const task =
        vertexTaskStore.comment(
          params.id,
          by,
          note ? `Ready for review: ${note}` : 'Ready for review.'
        ) ?? moved
      return { ok: true, task: presentTask(task) }
    }
  }),
  defineMethod({
    name: 'tasks.comment',
    params: TaskComment,
    handler: (params) => {
      const task = vertexTaskStore.comment(params.id, params.author, params.body)
      if (!task) {
        throw new Error(`Task not found: ${params.id}`)
      }
      return { task: presentTask(task) }
    }
  })
]
