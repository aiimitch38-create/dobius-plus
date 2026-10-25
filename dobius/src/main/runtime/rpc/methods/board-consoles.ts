// Lead loop: an autonomous lead agent asks main to put a worker (or lead)
// console card on a worktree's Board. Main validates, enforces the worker caps
// against the persisted Board payload, and hands the launch to the renderer
// (window IPC `ui:boardSpawnConsole` plus the `boardSpawnConsole` client event)
// — the renderer owns tabs and cards.
import { randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import {
  checkWorkerCaps,
  isLeadId,
  leadConsoleRole,
  parseLeadConsoleRole,
  workerCapMessage,
  type LeadConsoleKind
} from '../../../../shared/lead-caps'
import type { RuntimeBoardSpawnConsoleEvent } from '../../../../shared/runtime-client-events'
import { isTuiAgent } from '../../../../shared/tui-agent-config'
import type { TuiAgent } from '../../../../shared/types'
import type { DobiusRuntimeService } from '../../dobius-runtime'
import { defineMethod, type RpcMethod } from '../core'

export const MAX_BOARD_CONSOLE_PROMPT_BYTES = 64 * 1024
const MAX_TITLE_CHARS = 200
const MAX_COMMAND_OVERRIDE_CHARS = 4000

type Raw = Record<string, unknown>
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)

const WorktreeSelector = z
  .unknown()
  .transform((v) => (typeof v === 'string' ? v : ''))
  .pipe(z.string().min(1, 'Missing worktree selector'))

const OptionalText = (maxChars: number, label: string) =>
  z
    .string()
    .max(maxChars, `${label} is too long`)
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v : undefined))

// Why: the CLI passes `worker`/`lead`; in-process callers may pass the full
// `worker:<lead>` role. Both collapse to the kind; the lead id is `leadId`.
const RoleParam = z.unknown().transform((value, ctx): LeadConsoleKind => {
  if (value === 'worker' || value === 'lead') {
    return value
  }
  const parsed = parseLeadConsoleRole(value)
  if (parsed) {
    return parsed.kind
  }
  ctx.addIssue({ code: 'custom', message: 'role must be worker or lead' })
  return z.NEVER
})

export const SpawnBoardConsoleParams = z
  .object({
    worktree: WorktreeSelector,
    agent: z.custom<TuiAgent>(isTuiAgent, { message: 'Unknown TUI agent' }),
    title: z.string().trim().min(1, 'Missing title').max(MAX_TITLE_CHARS, 'title is too long'),
    prompt: OptionalText(MAX_BOARD_CONSOLE_PROMPT_BYTES, 'prompt'),
    promptFile: z.string().min(1).optional(),
    role: RoleParam,
    leadId: z.custom<string>(isLeadId, { message: 'Invalid lead id' }),
    taskId: OptionalText(200, 'taskId'),
    commandOverride: OptionalText(MAX_COMMAND_OVERRIDE_CHARS, 'commandOverride'),
    replaceStaleCardIds: z.array(z.string().min(1)).max(50).optional()
  })
  .refine((p) => !(p.prompt && p.promptFile), {
    message: 'Pass prompt or promptFile, not both'
  })

export type SpawnBoardConsoleInput = z.input<typeof SpawnBoardConsoleParams>
export type SpawnBoardConsoleResult = {
  requestId: string
  worktreeId: string
  role: string
  /** False when no window or client was attached to receive the request. */
  delivered: boolean
}

const ListBoardConsolesParams = z.object({ worktree: WorktreeSelector })

export type BoardConsoleSummary = {
  id: string
  tabId: string
  title: string
  role: string | null
}

/** Console cards on one worktree's Board, read from the persisted UI payload. */
export function listBoardConsoleCards(
  boardsByWorktree: unknown,
  worktreeId: string
): BoardConsoleSummary[] {
  const board = isObj(boardsByWorktree) ? boardsByWorktree[worktreeId] : undefined
  if (!isObj(board) || !Array.isArray(board.cards)) {
    return []
  }
  return board.cards.flatMap((card) =>
    isObj(card) &&
    card.kind === 'console' &&
    typeof card.tabId === 'string' &&
    typeof card.id === 'string'
      ? [
          {
            id: card.id,
            tabId: card.tabId,
            title: typeof card.title === 'string' ? card.title : '',
            role: typeof card.role === 'string' ? card.role : null
          }
        ]
      : []
  )
}

function readPromptFile(path: string): string {
  if (!isAbsolute(path)) {
    throw new Error('promptFile must be an absolute path')
  }
  let stat: ReturnType<typeof statSync>
  try {
    stat = statSync(path)
  } catch (error) {
    throw new Error(
      `promptFile is not readable: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  if (!stat.isFile()) {
    throw new Error('promptFile must be a regular file')
  }
  if (stat.size > MAX_BOARD_CONSOLE_PROMPT_BYTES) {
    throw new Error(`promptFile exceeds ${MAX_BOARD_CONSOLE_PROMPT_BYTES} bytes`)
  }
  return readFileSync(path, 'utf8')
}

/**
 * Validates, enforces the worker caps server-side, and emits the spawn request
 * to the renderer. Exported for in-process callers (the lead watcher).
 */
export async function spawnBoardConsole(
  runtime: DobiusRuntimeService,
  input: SpawnBoardConsoleInput
): Promise<SpawnBoardConsoleResult> {
  const params = SpawnBoardConsoleParams.parse(input)
  const worktree = await runtime.showManagedWorktree(params.worktree)
  const worktreeId = worktree.id
  const role = leadConsoleRole(params.role, params.leadId)
  if (params.role === 'worker') {
    const existing = listBoardConsoleCards(runtime.getUIState().boardsByWorktree, worktreeId)
    const check = checkWorkerCaps(
      existing.map((c) => c.role),
      params.leadId
    )
    if (!check.ok) {
      throw new Error(workerCapMessage(check, params.leadId))
    }
  }
  const prompt = params.promptFile ? readPromptFile(params.promptFile) : params.prompt
  const requestId = randomUUID()
  const event: RuntimeBoardSpawnConsoleEvent = {
    type: 'boardSpawnConsole',
    requestId,
    worktreeId,
    agent: params.agent,
    title: params.title,
    ...(prompt && prompt.trim().length > 0 ? { prompt } : {}),
    role,
    leadId: params.leadId,
    ...(params.taskId ? { taskId: params.taskId } : {}),
    ...(params.commandOverride ? { commandOverride: params.commandOverride } : {}),
    ...(params.replaceStaleCardIds && params.replaceStaleCardIds.length > 0
      ? { replaceStaleCardIds: params.replaceStaleCardIds }
      : {})
  }
  const { delivered } = runtime.notifyBoardSpawnConsole(event)
  return { requestId, worktreeId, role, delivered }
}

export const BOARD_CONSOLE_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'board.spawnConsole',
    params: SpawnBoardConsoleParams,
    handler: (params, { runtime }) => spawnBoardConsole(runtime, params)
  }),
  defineMethod({
    name: 'board.listConsoles',
    params: ListBoardConsolesParams,
    handler: async (params, { runtime }): Promise<BoardConsoleSummary[]> => {
      const worktree = await runtime.showManagedWorktree(params.worktree)
      return listBoardConsoleCards(runtime.getUIState().boardsByWorktree, worktree.id)
    }
  })
]
