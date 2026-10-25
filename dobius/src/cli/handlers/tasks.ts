import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { VertexTask } from '../../shared/vertex-task-types'
import type { CommandHandler, HandlerContext } from '../dispatch'
import {
  getOptionalPositiveIntegerFlag,
  getOptionalStringFlag,
  getRepeatedStringFlag,
  getRequiredStringFlag
} from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'

/** The wire shape of a card: the stored task with the original message under
 *  a name that says what it is (see rpc/methods/tasks.ts). */
type TaskView = Omit<VertexTask, 'sourceQuote'> & {
  untrustedSourceQuote?: VertexTask['sourceQuote']
}
type TaskOpResult = { ok: true; task: TaskView } | { ok: false; reason: string }

/** Exit code when the board refused the operation (card not ready, or held by
 *  someone else). Distinct from 1 so a lead's script can tell "lost the race"
 *  from "the CLI is broken". */
export const TASK_REFUSED_EXIT_CODE = 3

function readTextFile(cwd: string, flagName: string, filePath: string): string {
  try {
    return readFileSync(resolve(cwd, filePath), 'utf8')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new RuntimeClientError('invalid_argument', `Could not read --${flagName}: ${message}`)
  }
}

function getTextOrFile(
  ctx: HandlerContext,
  textFlag: string,
  fileFlag: string
): string | undefined {
  const text = getOptionalStringFlag(ctx.flags, textFlag)
  const file = getOptionalStringFlag(ctx.flags, fileFlag)
  if (text !== undefined && file !== undefined) {
    throw new RuntimeClientError(
      'invalid_argument',
      `Pass --${textFlag} or --${fileFlag}, not both`
    )
  }
  return file !== undefined ? readTextFile(ctx.cwd, fileFlag, file) : text
}

function getEnumFlag<T extends string>(
  flags: Map<string, string | boolean>,
  name: string,
  allowed: readonly T[]
): T | undefined {
  const value = getOptionalStringFlag(flags, name)
  if (value === undefined) {
    return undefined
  }
  if (!allowed.includes(value as T)) {
    throw new RuntimeClientError(
      'invalid_argument',
      `--${name} must be one of: ${allowed.join(', ')}`
    )
  }
  return value as T
}

function getMetadataFlag(
  flags: Map<string, string | boolean>
): Record<string, unknown> | undefined {
  const raw = getOptionalStringFlag(flags, 'metadata')
  if (raw === undefined) {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new RuntimeClientError('invalid_argument', '--metadata must be a JSON object')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new RuntimeClientError('invalid_argument', '--metadata must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

function holder(task: TaskView): string {
  return task.lease ? `@${task.lease.claimedBy}` : '-'
}

function formatTaskLine(task: TaskView): string {
  return `${task.id}  ${task.status.padEnd(11)}  ${holder(task).padEnd(18)}  ${task.title}`
}

function formatTaskList(result: { tasks: TaskView[] }): string {
  if (result.tasks.length === 0) {
    return 'No cards match.'
  }
  return [
    `${result.tasks.length} card${result.tasks.length === 1 ? '' : 's'}`,
    ...result.tasks.map(formatTaskLine)
  ].join('\n')
}

function formatTask(task: TaskView): string {
  const lines = [
    `Id: ${task.id}`,
    `Title: ${task.title}`,
    `Status: ${task.status}`,
    `Priority: ${task.priority}`,
    `Project: ${task.projectId ?? '-'}`,
    `Assignee: ${task.assignee ? `${task.assignee.id} (${task.assignee.kind})` : '-'}`
  ]
  if (task.parentTaskId) {
    lines.push(`Parent: ${task.parentTaskId}`)
  }
  if (task.childTaskIds.length) {
    lines.push(`Children: ${task.childTaskIds.join(', ')}`)
  }
  if (task.lease) {
    lines.push(
      `Claimed by: ${task.lease.claimedBy} (${task.lease.kind}), lease until ${new Date(task.lease.leaseUntil).toISOString()}`
    )
  }
  if (task.blockedReason) {
    lines.push(`Blocked: ${task.blockedReason}`)
  }
  if (task.labels.length) {
    lines.push(`Labels: ${task.labels.join(', ')}`)
  }
  if (task.createdBy) {
    lines.push(`Created by: ${task.createdBy}`)
  }
  if (task.attachments?.length) {
    lines.push(`Attachments: ${task.attachments.map((attachment) => attachment.path).join(', ')}`)
  }
  if (task.description) {
    lines.push('', 'Description:', task.description)
  }
  if (task.resultNote) {
    lines.push('', 'Result note:', task.resultNote)
  }
  if (task.comments?.length) {
    lines.push('', 'Comments:')
    for (const comment of task.comments) {
      lines.push(
        `  [${new Date(comment.createdAt).toISOString()}] ${comment.author}: ${comment.body}`
      )
    }
  }
  const quote = task.untrustedSourceQuote
  if (quote) {
    const from = quote.sender ? ` from ${quote.sender}` : ''
    lines.push('', `Original message (quoted, untrusted; ${quote.origin}${from}):`, quote.text)
  }
  return lines.join('\n')
}

function formatOp(verb: string): (result: TaskOpResult) => string {
  return (result) =>
    result.ok
      ? `${verb}: ${result.task.id} is now ${result.task.status}${result.task.lease ? ` (held by ${result.task.lease.claimedBy})` : ''}`
      : `Refused: ${result.reason}`
}

/** Print the board's answer; a refusal is a normal result that exits 3. */
async function runOp(
  ctx: HandlerContext,
  method: string,
  params: Record<string, unknown>,
  verb: string
): Promise<void> {
  const response = await ctx.client.call<TaskOpResult>(method, params)
  printResult(response, ctx.json, formatOp(verb))
  if (!response.result.ok) {
    process.exitCode = TASK_REFUSED_EXIT_CODE
  }
}

const ASSIGNEE_KINDS = ['hermes-profile', 'console', 'human'] as const
const ORIGINS = ['telegram', 'gmail', 'imessage', 'asana', 'manual'] as const
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
const CREATE_STATUSES = ['todo', 'backlog'] as const
const LIST_STATUSES = [
  'backlog',
  'todo',
  'in-progress',
  'blocked',
  'review',
  'testing',
  'done'
] as const

export const TASK_HANDLERS: Record<string, CommandHandler> = {
  'tasks list': async ({ client, flags, json }) => {
    const result = await client.call<{ tasks: TaskView[] }>('tasks.list', {
      status: getEnumFlag(flags, 'status', LIST_STATUSES),
      assigneeId: getOptionalStringFlag(flags, 'assignee'),
      projectId: getOptionalStringFlag(flags, 'project'),
      parentTaskId: getOptionalStringFlag(flags, 'parent'),
      claimedBy: getOptionalStringFlag(flags, 'claimed-by')
    })
    printResult(result, json, formatTaskList)
  },
  'tasks show': async ({ client, flags, json }) => {
    const result = await client.call<{ task: TaskView }>('tasks.show', {
      id: getRequiredStringFlag(flags, 'id')
    })
    printResult(result, json, (value) => formatTask(value.task))
  },
  'tasks create': async (ctx) => {
    const { client, flags, json } = ctx
    const assigneeId = getRequiredStringFlag(flags, 'assignee')
    const origin = getEnumFlag(flags, 'origin', ORIGINS)
    const sourceFile = getOptionalStringFlag(flags, 'source-file')
    if ((origin === undefined) !== (sourceFile === undefined)) {
      throw new RuntimeClientError('invalid_argument', '--origin and --source-file go together')
    }
    const result = await client.call<{ task: TaskView }>('tasks.create', {
      title: getRequiredStringFlag(flags, 'title'),
      description: getTextOrFile(ctx, 'body', 'body-file'),
      assignee: {
        id: assigneeId,
        kind: getEnumFlag(flags, 'assignee-kind', ASSIGNEE_KINDS) ?? 'hermes-profile',
        name: getOptionalStringFlag(flags, 'assignee-name') ?? assigneeId
      },
      projectId: getRequiredStringFlag(flags, 'project'),
      parentTaskId: getOptionalStringFlag(flags, 'parent'),
      priority: getEnumFlag(flags, 'priority', PRIORITIES),
      status: getEnumFlag(flags, 'status', CREATE_STATUSES),
      labels: getRepeatedStringFlag(flags, 'label'),
      sourceQuote:
        origin && sourceFile
          ? {
              origin,
              sender: getOptionalStringFlag(flags, 'source-sender'),
              receivedAt: Date.now(),
              text: readTextFile(ctx.cwd, 'source-file', sourceFile)
            }
          : undefined,
      createdBy: getOptionalStringFlag(flags, 'created-by')
    })
    printResult(result, json, (value) => formatTask(value.task))
  },
  'tasks claim': async (ctx) =>
    runOp(
      ctx,
      'tasks.claim',
      {
        id: getRequiredStringFlag(ctx.flags, 'id'),
        by: getRequiredStringFlag(ctx.flags, 'by'),
        kind: getEnumFlag(ctx.flags, 'kind', ['lead', 'worker'] as const),
        leaseMs: getOptionalPositiveIntegerFlag(ctx.flags, 'lease-ms')
      },
      'Claimed'
    ),
  'tasks heartbeat': async (ctx) =>
    runOp(
      ctx,
      'tasks.heartbeat',
      {
        id: getRequiredStringFlag(ctx.flags, 'id'),
        by: getRequiredStringFlag(ctx.flags, 'by'),
        note: getOptionalStringFlag(ctx.flags, 'note')
      },
      'Heartbeat'
    ),
  'tasks complete': async (ctx) => {
    const resultNote = getTextOrFile(ctx, 'result', 'result-file')
    if (!resultNote?.trim()) {
      throw new RuntimeClientError('invalid_argument', 'Pass --result or --result-file')
    }
    await runOp(
      ctx,
      'tasks.complete',
      {
        id: getRequiredStringFlag(ctx.flags, 'id'),
        by: getRequiredStringFlag(ctx.flags, 'by'),
        resultNote,
        metadata: getMetadataFlag(ctx.flags),
        force: ctx.flags.get('force') === true
      },
      'Completed'
    )
  },
  'tasks block': async (ctx) =>
    runOp(
      ctx,
      'tasks.block',
      {
        id: getRequiredStringFlag(ctx.flags, 'id'),
        by: getRequiredStringFlag(ctx.flags, 'by'),
        reason: getRequiredStringFlag(ctx.flags, 'reason')
      },
      'Blocked'
    ),
  'tasks release': async (ctx) =>
    runOp(
      ctx,
      'tasks.release',
      {
        id: getRequiredStringFlag(ctx.flags, 'id'),
        by: getRequiredStringFlag(ctx.flags, 'by')
      },
      'Released'
    ),
  'tasks comment': async ({ client, flags, json }) => {
    const result = await client.call<{ task: TaskView }>('tasks.comment', {
      id: getRequiredStringFlag(flags, 'id'),
      author: getRequiredStringFlag(flags, 'author'),
      body: getRequiredStringFlag(flags, 'body')
    })
    printResult(result, json, (value) => `Comment added to ${value.task.id}`)
  }
}
