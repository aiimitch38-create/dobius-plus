// `dobius orchestration send --to board:<orchestratorCardId>`: main-side relay
// that fans a message out to a Board orchestrator card's wired consoles the
// same way typing in the card does (shared routing + recipients), from the
// card's own mailbox so replies show up in the card.
import {
  BOARD_ORCHESTRATOR_ADDRESS_PREFIX,
  orchestratorHandle,
  orchestratorRelayTargets,
  relaySubject,
  relayThreadId,
  routeOrchestratorMessage,
  wiredScopedConsoles,
  type OrchestratorRoute,
  type RelaySkip
} from '../../../shared/board-orchestrator-relay'
import { checkExecutionAdmission } from '../../agents/execution-gate'
import { BoardConsoleError } from '../../../shared/board-console-errors'
import type { DobiusRuntimeService } from '../dobius-runtime'
import type { MessagePriority, MessageRow, MessageType } from './db'
import { formatMessagesForInjection } from './formatter'

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
  ambiguous:
    'several wired consoles have that name, so nothing was sent. Rename one on the Board, or send to it with card:<card id>.',
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
  | 'getTerminalTabActiveLeafId'
  | 'getTerminalAgentStatus'
  | 'isCursorAgentTerminal'
  | 'sendTerminal'
  | 'getOrchestrationDb'
  | 'notifyMessageArrived'
>

export type RelayRefusalReason = 'paused' | 'no-agent' | 'permission' | 'not-writable'
export type RelayRefusal = {
  cardId: string
  title: string
  handle: string
  reason: RelayRefusalReason
  /** True when some text may already be typed there (Enter was not pressed). */
  partlyTyped: boolean
}

class RelayRefused extends Error {
  constructor(readonly reason: RelayRefusalReason) {
    super(`board_relay_${reason}`)
  }
}

const crewPaused = (): boolean => !checkExecutionAdmission('board-relay').allowed

/**
 * Same rule as guarded `terminal.send` (requireAgentStatus 'sendable') plus
 * Pause crew: an agent is in the foreground and not on a permission prompt.
 * Why pause is checked again after the await: a pause flipped mid-check must
 * stop the very next write.
 */
async function assertDeliverable(runtime: RelayRuntime, handle: string): Promise<void> {
  if (crewPaused()) {
    throw new RelayRefused('paused')
  }
  const agent = await runtime.getTerminalAgentStatus(handle)
  if (!agent.isRunningAgent) {
    throw new RelayRefused('no-agent')
  }
  if (agent.status === 'permission') {
    throw new RelayRefused('permission')
  }
  if (crewPaused()) {
    throw new RelayRefused('paused')
  }
}

const REFUSAL_WORDS: Record<RelayRefusalReason, string> = {
  paused: 'the crew is paused',
  'no-agent': 'no agent is running in it',
  permission: 'its agent is waiting on a permission prompt',
  'not-writable': 'it is not accepting input'
}
const SKIP_WORDS: Record<RelaySkip['reason'], string> = {
  'not-running': 'not running',
  'pane-unclear': 'several running panes, none focused'
}

const listNames = (rows: readonly { title: string }[], why: (i: number) => string): string =>
  rows.map((r, i) => `"${r.title}" (${why(i)})`).join(', ')

/**
 * Relays one message to the orchestrator's wired consoles. The text is the
 * body (or the subject when there is no body), routed like the card's input:
 * `@Name rest` reaches one wired console, anything else reaches all of them.
 * Delivery is guarded: Pause crew and the sendable check run before the text
 * and again before Enter, so a permission or update menu cannot eat it.
 * Known difference: the card puts a wired Goal's block in front of a task;
 * that throttle lives in the renderer, so a CLI relay sends the text only.
 */
export async function relayToBoardOrchestrator(
  runtime: RelayRuntime,
  params: BoardOrchestratorSendParams,
  now: () => number = Date.now
): Promise<{
  messages: MessageRow[]
  recipients: number
  orchestratorCardId: string
  refused: RelayRefusal[]
  skipped: RelaySkip[]
  /** Cursor Agent consoles: the text is typed in, Enter is left to the user. */
  typedNotSubmitted: { cardId: string; title: string; handle: string }[]
}> {
  if (params.type === 'worker_done' || params.type === 'heartbeat') {
    throw new Error(
      `${params.type} messages must be sent to a concrete coordinator terminal handle, not a board orchestrator.`
    )
  }
  const query = params.to.slice(BOARD_ORCHESTRATOR_ADDRESS_PREFIX.length)
  const found = findBoardOrchestrator(runtime.getUIState().boardsByWorktree, query)
  const label = found.name || found.cardId
  if (crewPaused()) {
    throw new BoardConsoleError(
      'board_orchestrator_paused',
      `the crew is paused, so nothing was sent to orchestrator "${label}". Resume it on the Agents page.`
    )
  }
  const text = params.body?.trim() ? params.body : params.subject
  const route = routeOrchestratorMessage(text, wiredScopedConsoles(found.cards, found.wiredCardIds))
  if (route.kind === 'refuse') {
    throw new BoardConsoleError(
      'board_orchestrator_refused',
      `orchestrator "${label}": ${REFUSAL_TEXT[route.reason]}`
    )
  }
  const { terminals } = await runtime.listTerminals(
    `id:${found.worktreeId}`,
    RELAY_TERMINAL_LIST_LIMIT
  )
  const { targets, skipped } = orchestratorRelayTargets(
    found.cards,
    found.wiredCardIds,
    route.kind === 'one' ? [route.cardId] : undefined,
    terminals,
    (tabId) => runtime.getTerminalTabActiveLeafId(tabId)
  )
  if (targets.length === 0) {
    const why = skipped.length > 0 ? ` (${listNames(skipped, (i) => SKIP_WORDS[skipped[i].reason])})` : ''
    throw new BoardConsoleError(
      'board_orchestrator_none_running',
      `none of the consoles wired to orchestrator "${label}" is running${why}. Restart them on the Board, then send again.`
    )
  }
  const db = runtime.getOrchestrationDb()
  const from = orchestratorHandle(found.cardId)
  const threadId = params.threadId ?? relayThreadId(found.cardId, now())
  const delivered: MessageRow[] = []
  const refused: RelayRefusal[] = []
  const typedNotSubmitted: { cardId: string; title: string; handle: string }[] = []
  for (const target of targets) {
    const handle = target.terminal.handle
    let partlyTyped = false
    let message: MessageRow | null = null
    try {
      await assertDeliverable(runtime, handle)
      message = db.insertMessage({
        from,
        to: handle,
        subject: relaySubject(route.text),
        body: route.text,
        type: params.type,
        priority: params.priority,
        threadId,
        payload: params.payload
      })
      const sent = message
      // Why stamped now, before any await: the runtime's unguarded push-on-idle
      // must never pick this row up and type it again (with its own Enter)
      // while this guarded send waits. It stays readable with `orchestration check`.
      db.markAsDelivered([sent.id])
      // Why: Cursor treats injected text as editable prompt input; submitting it
      // stays with the user, same as push-on-idle.
      const submit = !runtime.isCursorAgentTerminal(handle)
      // Why: text, a settle delay, then Enter, each write rechecked (sendTerminal).
      await runtime.sendTerminal(
        handle,
        { text: formatMessagesForInjection([sent]), enter: submit },
        {
          beforeWrite: async () => {
            await assertDeliverable(runtime, handle)
            partlyTyped = true
          }
        }
      )
      delivered.push(sent)
      if (!submit) {
        typedNotSubmitted.push({ cardId: target.cardId, title: target.title, handle })
      }
    } catch (error) {
      refused.push({
        cardId: target.cardId,
        title: target.title,
        handle,
        reason: error instanceof RelayRefused ? error.reason : 'not-writable',
        partlyTyped
      })
    } finally {
      if (message) {
        runtime.notifyMessageArrived(handle, message.type)
      }
    }
  }
  if (delivered.length === 0) {
    throw new BoardConsoleError(
      'board_orchestrator_not_delivered',
      `orchestrator "${label}" reached no console: ${listNames(refused, (i) =>
        refused[i].partlyTyped
          ? `${REFUSAL_WORDS[refused[i].reason]}; text may be partly typed, Enter was not pressed`
          : REFUSAL_WORDS[refused[i].reason]
      )}.`
    )
  }
  return {
    messages: delivered,
    recipients: delivered.length,
    orchestratorCardId: found.cardId,
    refused,
    skipped,
    typedNotSubmitted
  }
}
