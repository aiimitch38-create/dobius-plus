// `dobius orchestration send --to board:<orchestratorCardId>`: main-side relay
// that fans a message out to a Board orchestrator card's wired consoles the
// same way typing in the card does (shared routing + recipients), from the
// card's own mailbox so replies show up in the card.
import {
  BOARD_ORCHESTRATOR_ADDRESS_PREFIX,
  orchestratorHandle,
  orchestratorRelayRecipients,
  relaySubject,
  relayThreadId,
  routeOrchestratorMessage,
  wiredScopedConsoles,
  type OrchestratorRoute
} from '../../../shared/board-orchestrator-relay'
import { BoardConsoleError } from '../../../shared/board-console-errors'
import type { DobiusRuntimeService } from '../dobius-runtime'
import type { MessagePriority, MessageRow, MessageType } from './db'

type Raw = Record<string, unknown>
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)

// Why: a busy board holds far more terminals than the default list page.
const RELAY_TERMINAL_LIST_LIMIT = 1000

export function isBoardOrchestratorAddress(to: string): boolean {
  return to.startsWith(BOARD_ORCHESTRATOR_ADDRESS_PREFIX)
}

type RelayCard = { id: string; kind: string; tabId?: unknown; title?: unknown }
type FoundOrchestrator = {
  worktreeId: string
  cardId: string
  name: string
  wiredCardIds: string[]
  cards: RelayCard[]
}

function boardCards(board: unknown): RelayCard[] {
  if (!isObj(board) || !Array.isArray(board.cards)) {
    return []
  }
  return board.cards.filter(
    (c): c is RelayCard => isObj(c) && typeof c.id === 'string' && typeof c.kind === 'string'
  )
}

/**
 * Finds the orchestrator card a `board:` address names, on any Board. A card id
 * wins, then an exact name, then a name that differs only by letter case.
 * Why it throws instead of guessing: the relay types into several agents.
 */
export function findBoardOrchestrator(boardsByWorktree: unknown, query: string): FoundOrchestrator {
  const all: FoundOrchestrator[] = []
  for (const [worktreeId, board] of Object.entries(isObj(boardsByWorktree) ? boardsByWorktree : {})) {
    const cards = boardCards(board)
    for (const card of cards) {
      if (card.kind !== 'orchestrator') {
        continue
      }
      const raw = card as Raw
      all.push({
        worktreeId,
        cardId: card.id,
        name: typeof raw.name === 'string' ? raw.name : '',
        wiredCardIds: Array.isArray(raw.wiredCardIds)
          ? raw.wiredCardIds.filter((id): id is string => typeof id === 'string')
          : [],
        cards
      })
    }
  }
  const name = query.trim()
  const byId = all.filter((o) => o.cardId === name)
  const exact = all.filter((o) => o.name.trim() === name)
  const loose = all.filter((o) => o.name.trim().toLowerCase() === name.toLowerCase())
  const matches = byId.length > 0 ? byId : exact.length > 0 ? exact : loose
  if (matches.length === 0) {
    throw new BoardConsoleError(
      'board_orchestrator_not_found',
      `no orchestrator card "${name}" on any Board. Use board:<orchestrator card id>.`
    )
  }
  if (matches.length > 1) {
    throw new BoardConsoleError(
      'board_orchestrator_ambiguous',
      `${matches.length} orchestrator cards are named "${name}" (card ids: ${matches
        .map((o) => o.cardId)
        .join(', ')}). Use the card id.`
    )
  }
  return matches[0]
}

const REFUSAL_TEXT: Record<Extract<OrchestratorRoute, { kind: 'refuse' }>['reason'], string> = {
  'outside-scope': 'that console is not wired to this orchestrator card, so nothing was sent.',
  workspace: 'workspaces are managed from the main command bar, not from an orchestrator card.',
  undo: 'undo and redo work from the main command bar only.',
  'nothing-wired': 'no consoles are wired to this orchestrator card yet.'
}

export type BoardOrchestratorSendParams = {
  to: string
  subject: string
  body?: string
  type?: MessageType
  priority?: MessagePriority
  threadId?: string
  payload?: string
}

type RelayRuntime = Pick<
  DobiusRuntimeService,
  | 'getUIState'
  | 'listTerminals'
  | 'getOrchestrationDb'
  | 'deliverPendingMessagesForHandle'
  | 'notifyMessageArrived'
>

/**
 * Relays one message to the orchestrator's wired consoles. The text is the
 * body (or the subject when there is no body), routed like the card's input:
 * `@Name rest` reaches one wired console, anything else reaches all of them.
 * Known difference: the card puts a wired Goal's block in front of a task;
 * that throttle lives in the renderer, so a CLI relay sends the text only.
 */
export async function relayToBoardOrchestrator(
  runtime: RelayRuntime,
  params: BoardOrchestratorSendParams,
  now: () => number = Date.now
): Promise<{ messages: MessageRow[]; recipients: number; orchestratorCardId: string }> {
  if (params.type === 'worker_done' || params.type === 'heartbeat') {
    throw new Error(
      `${params.type} messages must be sent to a concrete coordinator terminal handle, not a board orchestrator.`
    )
  }
  const query = params.to.slice(BOARD_ORCHESTRATOR_ADDRESS_PREFIX.length)
  const found = findBoardOrchestrator(runtime.getUIState().boardsByWorktree, query)
  const text = params.body?.trim() ? params.body : params.subject
  const route = routeOrchestratorMessage(text, wiredScopedConsoles(found.cards, found.wiredCardIds))
  if (route.kind === 'refuse') {
    throw new BoardConsoleError(
      'board_orchestrator_refused',
      `orchestrator "${found.name || found.cardId}": ${REFUSAL_TEXT[route.reason]}`
    )
  }
  const { terminals } = await runtime.listTerminals(
    `id:${found.worktreeId}`,
    RELAY_TERMINAL_LIST_LIMIT
  )
  const recipients = orchestratorRelayRecipients(
    found.cards,
    found.wiredCardIds,
    route.kind === 'one' ? [route.cardId] : undefined,
    terminals
  )
  if (recipients.length === 0) {
    throw new BoardConsoleError(
      'board_orchestrator_none_running',
      `none of the consoles wired to orchestrator "${found.name || found.cardId}" is running. Restart them on the Board, then send again.`
    )
  }
  const db = runtime.getOrchestrationDb()
  const from = orchestratorHandle(found.cardId)
  const threadId = params.threadId ?? relayThreadId(found.cardId, now())
  const messages = recipients.map((r) =>
    db.insertMessage({
      from,
      to: r.handle,
      subject: relaySubject(route.text),
      body: route.text,
      type: params.type,
      priority: params.priority,
      threadId,
      payload: params.payload
    })
  )
  for (const message of messages) {
    runtime.deliverPendingMessagesForHandle(message.to_handle)
    runtime.notifyMessageArrived(message.to_handle, message.type)
  }
  return { messages, recipients: recipients.length, orchestratorCardId: found.cardId }
}
