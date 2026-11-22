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
import type { RuntimeTerminalSummary } from '../../../../shared/runtime-types'
import { BoardConsoleError } from '../../../../shared/board-console-errors'
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
const ResolveBoardConsoleParams = z.object({
  worktree: WorktreeSelector,
  card: z.string().trim().min(1, 'Missing card name').max(MAX_TITLE_CHARS, 'card name is too long')
})

export type BoardConsoleSummary = {
  id: string
  tabId: string
  title: string
  role: string | null
  /** Agent kind saved on the card (claude, codex, a blank terminal id…). */
  agent: string | null
}

/** A console card joined with its terminal as it is right now. */
export type BoardConsoleRow = BoardConsoleSummary & {
  /** Current terminal handle for the card's tab; null when the tab has no terminal. */
  handle: string | null
  /** True only when the card's terminal has a connected PTY. */
  running: boolean
  /**
   * True when the card's tab has several live panes and none is known to be
   * the focused one. handle is then null: nothing may be sent on a guess.
   */
  paneUnclear: boolean
  worktreeId: string
  worktreePath: string
}

// Why: a busy board holds far more terminals than the default list page.
const BOARD_TERMINAL_LIST_LIMIT = 1000

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
            role: typeof card.role === 'string' ? card.role : null,
            agent: typeof card.agentKind === 'string' ? card.agentKind : null
          }
        ]
      : []
  )
}

/**
 * Console cards with their live terminal. Why resolved per call: a terminal
 * handle changes whenever the console restarts, so a stored handle goes stale;
 * the card's tabId is the stable link (same join as the Board orchestrator card).
 */
export async function listBoardConsoleRows(
  runtime: DobiusRuntimeService,
  worktreeSelector: string
): Promise<BoardConsoleRow[]> {
  const worktree = await runtime.showManagedWorktree(worktreeSelector)
  const cards = listBoardConsoleCards(runtime.getUIState().boardsByWorktree, worktree.id)
  if (cards.length === 0) {
    return []
  }
  const { terminals } = await runtime.listTerminals(
    `id:${worktree.id}`,
    BOARD_TERMINAL_LIST_LIMIT
  )
  return cards.map((card) => {
    // Why: while the renderer graph is unavailable, terminals are listed from
    // PTY records with tabId `pty:<ptyId>`; originTabId keeps the card link so
    // a running console is not reported as stopped.
    const inTab = terminals.filter((t) => t.tabId === card.tabId || t.originTabId === card.tabId)
    const picked = pickConsoleTerminal(inTab, runtime.getTerminalTabActiveLeafId(card.tabId))
    return {
      ...card,
      handle: picked.terminal?.handle ?? null,
      running: picked.running,
      paneUnclear: picked.paneUnclear,
      worktreeId: worktree.id,
      worktreePath: worktree.path
    }
  })
}

type ConsoleTerminal = Pick<RuntimeTerminalSummary, 'handle' | 'leafId' | 'connected' | 'ptyId'>
const isLiveTerminal = (t: ConsoleTerminal): boolean => t.connected && t.ptyId !== null

/**
 * Chooses which pane of a console card's tab is "the console". One live pane is
 * unambiguous. With several live panes only the tab's focused pane counts; if
 * that is not known the card is reported as unclear rather than guessed at.
 */
export function pickConsoleTerminal<T extends ConsoleTerminal>(
  inTab: T[],
  activeLeafId: string | null
): { terminal: T | null; running: boolean; paneUnclear: boolean } {
  const live = inTab.filter(isLiveTerminal)
  if (live.length === 0) {
    const shown = inTab.find((t) => t.leafId === activeLeafId) ?? inTab[0] ?? null
    return { terminal: shown, running: false, paneUnclear: false }
  }
  if (live.length === 1) {
    return { terminal: live[0], running: true, paneUnclear: false }
  }
  const focused = live.find((t) => t.leafId === activeLeafId)
  return focused
    ? { terminal: focused, running: true, paneUnclear: false }
    : { terminal: null, running: true, paneUnclear: true }
}

const quoted = (values: string[]): string => values.map((v) => `"${v}"`).join(', ')

/**
 * Picks the one running console a name refers to. A card id wins, then an exact
 * title, then a title that differs only by letter case.
 * Why it throws instead of guessing: a message typed into the wrong agent is
 * worse than a failed send, so there is no fallback to any other terminal.
 */
export function resolveBoardConsole(
  rows: BoardConsoleRow[],
  query: string
): BoardConsoleRow & { handle: string } {
  const name = query.trim()
  const byId = rows.filter((r) => r.id === name)
  const exact = rows.filter((r) => r.title.trim() === name)
  const loose = rows.filter((r) => r.title.trim().toLowerCase() === name.toLowerCase())
  const matches = byId.length > 0 ? byId : exact.length > 0 ? exact : loose
  if (matches.length === 0) {
    const known = rows.length > 0 ? ` Console cards here: ${quoted(rows.map((r) => r.title))}.` : ''
    throw new BoardConsoleError(
      'board_card_not_found',
      `no console card named "${name}" on this Board.${known}`
    )
  }
  if (matches.length > 1) {
    throw new BoardConsoleError(
      'board_card_ambiguous',
      `${matches.length} console cards are named "${name}" (card ids: ${matches
        .map((r) => r.id)
        .join(', ')}). Rename one on the Board, or use its card id.`
    )
  }
  const [row] = matches
  if (row.paneUnclear) {
    throw new BoardConsoleError(
      'board_card_pane_unclear',
      `console card "${row.title}" has several running panes and none is the focused one. Click the pane you mean on the Board (or close the extra pane), then send again.`
    )
  }
  if (!row.running || !row.handle) {
    throw new BoardConsoleError(
      'board_card_not_running',
      `console card "${row.title}" has no running terminal. Restart it on the Board, then send again.`
    )
  }
  return { ...row, handle: row.handle }
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
  const existing = listBoardConsoleCards(runtime.getUIState().boardsByWorktree, worktreeId)
  if (params.role === 'lead') {
    // Why: one live lead console per lead; only cards named for replacement may be superseded.
    const replacing = new Set(params.replaceStaleCardIds ?? [])
    if (existing.some((c) => c.role === role && !replacing.has(c.id))) {
      throw new Error(`lead_console_exists: ${params.leadId} already has a lead console`)
    }
  }
  if (params.role === 'worker') {
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
    // Why: stale-card replacement is decided in main by the lead watcher; external
    // callers must not be able to name cards for removal.
    handler: (params, { runtime }) => {
      const { replaceStaleCardIds: _ignored, ...external } = params
      return spawnBoardConsole(runtime, external)
    }
  }),
  defineMethod({
    name: 'board.listConsoles',
    params: ListBoardConsolesParams,
    handler: (params, { runtime }): Promise<BoardConsoleRow[]> =>
      listBoardConsoleRows(runtime, params.worktree)
  }),
  defineMethod({
    name: 'board.resolveConsole',
    params: ResolveBoardConsoleParams,
    handler: async (params, { runtime }) =>
      resolveBoardConsole(await listBoardConsoleRows(runtime, params.worktree), params.card)
  })
]
