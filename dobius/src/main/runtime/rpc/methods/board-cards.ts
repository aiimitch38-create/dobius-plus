// `dobius board list` and `dobius board restart|rename|note|close`. Main reads
// the saved Board (every card kind, consoles joined with their live terminal)
// and resolves a card name there; the action itself runs in the Board window,
// which owns cards and tabs (same main-to-renderer path as board.spawnConsole,
// with a reply like board.openWebTile).
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { checkExecutionAdmission } from '../../../agents/execution-gate'
import {
  BOARD_CARD_ACTION_REPLY_CODES,
  BOARD_CARD_TITLE_MAX,
  BOARD_NOTE_TEXT_MAX,
  resolveBoardCardName,
  type BoardCardActionKind,
  type BoardCardActionRequest
} from '../../../../shared/board-card-actions'
import { BoardConsoleError } from '../../../../shared/board-console-errors'
import { CliActionError } from '../../../../shared/cli-action-errors'
import type { CliActionErrorCode } from '../../../../shared/cli-action-errors'
import type { DobiusRuntimeService } from '../../dobius-runtime'
import { defineMethod, type RpcMethod } from '../core'
import { listBoardConsoleRows } from './board-consoles'

type Raw = Record<string, unknown>
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)

// Why capped: a board can hold thousands of strokes; the list stays readable and bounded.
export const BOARD_LIST_MAX_CARDS = 500
const PREVIEW_CHARS = 80
const REPLY_MESSAGE_MAX = 500

export type BoardCardRow = {
  id: string
  kind: string
  title: string
  /** First words of a note or text card. */
  preview: string | null
  /** Consoles only: 'running', 'not running' or 'pane unclear'. Null for other cards. */
  status: 'running' | 'not running' | 'pane unclear' | null
  tabId: string | null
  agent: string | null
  role: string | null
  /** Live terminal handle (consoles); changes on restart, so look it up each time. */
  handle: string | null
}

export type BoardCardList = {
  worktreeId: string
  worktreePath: string
  cards: BoardCardRow[]
  totalCount: number
  truncated: boolean
}

type SavedCard = { id: string; kind: string; title: string; raw: Raw }

function savedCards(runtime: DobiusRuntimeService, worktreeId: string): SavedCard[] {
  const boards = runtime.getUIState().boardsByWorktree as unknown
  const board = isObj(boards) ? boards[worktreeId] : undefined
  if (!isObj(board) || !Array.isArray(board.cards)) {
    return []
  }
  return board.cards.flatMap((card) =>
    isObj(card) && typeof card.id === 'string' && typeof card.kind === 'string'
      ? [
          {
            id: card.id,
            kind: card.kind,
            title:
              card.kind === 'orchestrator' && typeof card.name === 'string' && card.name
                ? card.name
                : typeof card.title === 'string'
                  ? card.title
                  : '',
            raw: card
          }
        ]
      : []
  )
}

function preview(card: Raw): string | null {
  const text = card.kind === 'note' || card.kind === 'text' ? card.text : card.kind === 'goal' ? card.goal : null
  if (typeof text !== 'string' || !text.trim()) {
    return null
  }
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS - 1)}…` : flat
}

export async function listBoardCards(
  runtime: DobiusRuntimeService,
  worktreeSelector: string
): Promise<BoardCardList> {
  const worktree = await runtime.showManagedWorktree(worktreeSelector)
  const cards = savedCards(runtime, worktree.id)
  const consoles = new Map(
    (cards.some((c) => c.kind === 'console')
      ? await listBoardConsoleRows(runtime, worktreeSelector)
      : []
    ).map((row) => [row.id, row])
  )
  const rows = cards.slice(0, BOARD_LIST_MAX_CARDS).map((card): BoardCardRow => {
    const live = consoles.get(card.id)
    return {
      id: card.id,
      kind: card.kind,
      title: card.title,
      preview: preview(card.raw),
      status: live
        ? live.paneUnclear
          ? 'pane unclear'
          : live.running && live.handle
            ? 'running'
            : 'not running'
        : null,
      tabId: typeof card.raw.tabId === 'string' ? card.raw.tabId : null,
      agent: live?.agent ?? null,
      role: live?.role ?? null,
      handle: live && !live.paneUnclear && live.running ? live.handle : null
    }
  })
  return {
    worktreeId: worktree.id,
    worktreePath: worktree.path,
    cards: rows,
    totalCount: cards.length,
    truncated: cards.length > rows.length
  }
}

/** The one card a name refers to on the saved Board; throws on none or several. */
export function resolveSavedCard(cards: SavedCard[], query: string): SavedCard {
  const resolved = resolveBoardCardName(cards, query)
  if (resolved.ok) {
    return resolved.card
  }
  if (resolved.reason === 'ambiguous') {
    throw new BoardConsoleError(
      'board_card_ambiguous',
      `${resolved.matches.length} cards are named "${query.trim()}" (card ids: ${resolved.matches
        .map((c) => c.id)
        .join(', ')}). Rename one on the Board, or use its card id.`
    )
  }
  throw new BoardConsoleError(
    'board_card_not_found',
    `no card named "${query.trim()}" on this Board. Run \`dobius board list\` to see card ids and titles.`
  )
}

const WorktreeSelector = z
  .unknown()
  .transform((v) => (typeof v === 'string' ? v : ''))
  .pipe(z.string().min(1, 'Missing worktree selector'))

const CardName = z.string().trim().min(1, 'Missing card').max(BOARD_CARD_TITLE_MAX, 'card name is too long')

const ListParams = z.object({ worktree: WorktreeSelector })

export const BoardCardActionParams = z
  .object({
    worktree: WorktreeSelector,
    action: z.enum(['restart', 'rename', 'note', 'close']),
    card: CardName.optional(),
    title: z.string().trim().min(1, 'Missing title').max(BOARD_CARD_TITLE_MAX, 'title is too long').optional(),
    text: z.string().max(BOARD_NOTE_TEXT_MAX, 'note text is too long').optional(),
    force: z.boolean().optional()
  })
  .refine((p) => p.action === 'note' || p.card !== undefined, { message: 'Missing card' })
  .refine((p) => p.action !== 'rename' || p.title !== undefined, { message: 'Missing title' })
  .refine((p) => p.action !== 'note' || (p.text !== undefined && p.text.trim().length > 0), {
    message: 'Missing note text'
  })

export type BoardCardActionResult = {
  requestId: string
  worktreeId: string
  action: BoardCardActionKind
  cardId: string
  message: string
}

const ALLOWED_REPLY_CODES = new Set<string>(BOARD_CARD_ACTION_REPLY_CODES)

export async function runBoardCardAction(
  runtime: DobiusRuntimeService,
  params: z.output<typeof BoardCardActionParams>
): Promise<BoardCardActionResult> {
  const worktree = await runtime.showManagedWorktree(params.worktree)
  const card = params.card ? resolveSavedCard(savedCards(runtime, worktree.id), params.card) : null
  if (params.action === 'restart' && card && card.kind !== 'console') {
    throw new CliActionError(
      'board_card_wrong_kind',
      `"${card.title}" is a ${card.kind} card; only console cards restart.`
    )
  }
  const event: BoardCardActionRequest = {
    requestId: randomUUID(),
    worktreeId: worktree.id,
    action: params.action,
    ...(card ? { cardId: card.id } : {}),
    ...(params.title !== undefined ? { title: params.title } : {}),
    ...(params.text !== undefined ? { text: params.text } : {}),
    ...(params.force ? { force: true } : {})
  }
  if (params.action === 'restart') {
    // Why checked here, right before the request: a restart starts an agent,
    // and Pause crew must stop anything autonomous from starting one.
    const admission = checkExecutionAdmission('board-relay')
    if (!admission.allowed) {
      throw new CliActionError('crew_paused', admission.message)
    }
  }
  const reply = await runtime.requestBoardCardAction(event)
  if (!reply) {
    throw new CliActionError(
      'board_window_unavailable',
      'The Dobius+ Board window is not open, so nothing was changed.'
    )
  }
  if (!reply.ok) {
    const code = ALLOWED_REPLY_CODES.has(reply.code) ? reply.code : 'board_card_action_failed'
    const message = String(reply.message).slice(0, REPLY_MESSAGE_MAX)
    if (code === 'board_card_not_found') {
      throw new BoardConsoleError('board_card_not_found', message)
    }
    throw new CliActionError(code as CliActionErrorCode, message)
  }
  return {
    requestId: event.requestId,
    worktreeId: worktree.id,
    action: params.action,
    cardId: reply.cardId,
    message: String(reply.message).slice(0, REPLY_MESSAGE_MAX)
  }
}

export const BOARD_CARD_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'board.listCards',
    params: ListParams,
    handler: (params, { runtime }) => listBoardCards(runtime, params.worktree)
  }),
  defineMethod({
    name: 'board.cardAction',
    params: BoardCardActionParams,
    handler: (params, { runtime }) => runBoardCardAction(runtime, params)
  })
]
