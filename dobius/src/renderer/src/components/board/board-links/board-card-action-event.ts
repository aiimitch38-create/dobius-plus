// `dobius board restart|rename|note|close`: main resolved the card from the
// saved Board and asks this window to act. The window owns cards and tabs, so
// it re-checks the card on its live board and uses the same functions the card
// menu uses: restartConsole (keeps a pinned account and any restricted launch
// profile), and for close the save-then-close order restart already follows.
import { closeTerminalTab } from '@/components/terminal/terminal-tab-actions'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { flushBoardPersistence, getBoard, type BoardCard, type BoardCardOf } from '@/store/slices/board'
import {
  BOARD_CARD_TITLE_MAX,
  BOARD_NOTE_TEXT_MAX,
  type BoardCardActionReply,
  type BoardCardActionRequest
} from '../../../../../shared/board-card-actions'
import { BOARD_CHROME_INSETS } from '../board-canvas/board-reveal'
import { boardFreeSpawnCenter } from '../board-canvas/board-spawn-placement'
import { screenToWorld } from '../board-canvas/board-viewport'
import { consoleDeliveryState } from '../board-delivery/board-delivery'
import { restartConsole } from '../board-delivery/console-lifecycle'
import { clearBoardConsoleEnded } from '../console-card/board-console-exit'

type Console = BoardCardOf<'console'>

// ponytail: a fixed window, not completion tracking; restartConsole reports no completion.
const RESTART_GUARD_MS = 15_000
const restartingSince = new Map<string, number>()

function claimRestart(cardId: string): boolean {
  const now = Date.now()
  for (const [id, at] of restartingSince) {
    if (now - at >= RESTART_GUARD_MS) {
      restartingSince.delete(id)
    }
  }
  if (restartingSince.has(cardId)) {
    return false
  }
  restartingSince.set(cardId, now)
  return true
}

function isPinnedTab(worktreeId: string, tabId: string): boolean {
  return (useAppStore.getState().unifiedTabsByWorktree?.[worktreeId] ?? []).some(
    (tab) => (tab.id === tabId || tab.entityId === tabId) && tab.isPinned
  )
}

const NOTE_SIZE = { w: 260, h: 200 }
const NOTE_GAP = 24
const HANDLED_LIMIT = 256
const handled = new Set<string>()

function firstTime(requestId: string): boolean {
  if (handled.has(requestId)) {
    return false
  }
  handled.add(requestId)
  if (handled.size > HANDLED_LIMIT) {
    const oldest = handled.values().next().value
    if (oldest !== undefined) {
      handled.delete(oldest)
    }
  }
  return true
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Same "it is mid-turn" rule the card menu uses before Restart asks to confirm. */
function isBusy(card: Console): boolean {
  const state = consoleDeliveryState(card.tabId)
  return state === 'working' || state === 'waiting' || state === 'blocked'
}

function notePosition(worktreeId: string, anchor: BoardCard | undefined): { x: number; y: number } {
  if (anchor) {
    return { x: anchor.x + anchor.w + NOTE_GAP, y: anchor.y }
  }
  const board = getBoard(useAppStore.getState(), worktreeId)
  const v = board.viewport
  const inset = BOARD_CHROME_INSETS
  const topLeft = screenToWorld({ x: inset.left, y: inset.top }, v)
  const bottomRight = screenToWorld(
    { x: window.innerWidth - inset.right, y: window.innerHeight - inset.bottom },
    v
  )
  const center = boardFreeSpawnCenter(
    { x: topLeft.x, y: topLeft.y, w: bottomRight.x - topLeft.x, h: bottomRight.y - topLeft.y },
    NOTE_SIZE,
    board.cards
  )
  return { x: center.x - NOTE_SIZE.w / 2, y: center.y - NOTE_SIZE.h / 2 }
}

/** Saves now so the next `dobius board list` sees the change; a failed save retries on the next change. */
async function savedNote(): Promise<string> {
  try {
    await flushBoardPersistence()
    return ''
  } catch (error) {
    return ` It is on screen but not saved yet (${errorText(error)}); the Board saves again on its next change.`
  }
}

async function act(event: BoardCardActionRequest): Promise<BoardCardActionReply> {
  const { requestId, worktreeId } = event
  const ok = (cardId: string, message: string): BoardCardActionReply => ({
    requestId,
    ok: true,
    cardId,
    message
  })
  const fail = (code: string, message: string): BoardCardActionReply => ({
    requestId,
    ok: false,
    code,
    message
  })
  const board = getBoard(useAppStore.getState(), worktreeId)
  const card = event.cardId ? board.cards.find((c) => c.id === event.cardId) : undefined
  if (event.cardId && !card) {
    return fail('board_card_not_found', 'That card is no longer on the Board.')
  }

  if (event.action === 'note') {
    const text = typeof event.text === 'string' ? event.text.slice(0, BOARD_NOTE_TEXT_MAX) : ''
    if (!text.trim()) {
      return fail('board_card_action_failed', 'A note needs text.')
    }
    const cardId = useAppStore.getState().addCard(worktreeId, {
      kind: 'note',
      text,
      color: 'yellow',
      ...notePosition(worktreeId, card),
      ...NOTE_SIZE,
      title: translate('board.insert.note', 'Note')
    })
    return ok(cardId, `Added a note to the Board.${await savedNote()}`)
  }

  if (!card) {
    return fail('board_card_not_found', 'Name the card with --card.')
  }

  if (event.action === 'rename') {
    const title = typeof event.title === 'string' ? event.title.trim().slice(0, BOARD_CARD_TITLE_MAX) : ''
    if (!title) {
      return fail('board_card_action_failed', 'The new title is empty.')
    }
    useAppStore
      .getState()
      .updateCard(worktreeId, card.id, card.kind === 'orchestrator' ? { title, name: title } : { title })
    return ok(card.id, `Renamed "${card.title}" to "${title}".${await savedNote()}`)
  }

  if (event.action === 'restart') {
    if (card.kind !== 'console') {
      return fail('board_card_wrong_kind', `"${card.title}" is a ${card.kind} card; only consoles restart.`)
    }
    if (!event.force && isBusy(card)) {
      return fail('board_card_busy', `"${card.title}" is working right now. Pass --force to stop its turn and restart.`)
    }
    // Why: a pinned-account restart finishes after this returns, so a second
    // request in that window would launch a second terminal for the same card.
    if (!claimRestart(card.id)) {
      return fail('board_card_busy', `"${card.title}" is already restarting. Try again in a moment.`)
    }
    // Why restartConsole: it keeps a pinned account and any restricted launch
    // profile, saves the Board before closing the old terminal, and leaves the
    // old terminal open if that save fails.
    return restartConsole(worktreeId, card)
      ? ok(card.id, `Restarting "${card.title}".`)
      : fail('board_card_action_failed', `"${card.title}" did not restart: its new terminal could not start.`)
  }

  // close
  if (card.kind === 'console' && !event.force && isBusy(card)) {
    return fail('board_card_busy', `"${card.title}" is working right now. Pass --force to end it and close the card.`)
  }
  // Why refuse before touching anything: closing a pinned tab normally asks
  // first; a CLI caller must not open that dialog, nor report a close that waits on it.
  if (card.kind === 'console' && !event.force && isPinnedTab(worktreeId, card.tabId)) {
    return fail('board_card_busy', `"${card.title}" is a pinned tab. Pass --force to close it anyway.`)
  }
  useAppStore.getState().removeCards(worktreeId, [card.id])
  try {
    // Why save first: main resolves card:<id> from the saved Board, so the card
    // must be gone there before its terminal closes; a send in between then
    // gets "not found" instead of landing in a terminal that is closing.
    await flushBoardPersistence()
  } catch (error) {
    return fail(
      'board_card_action_failed',
      `Removed "${card.title}" from the Board, but the Board could not be saved, so its terminal was left open: ${errorText(error)}`
    )
  }
  if (card.kind === 'console') {
    // force: the pinned check above already ran (or --force was given).
    closeTerminalTab(card.tabId, { force: true })
    clearBoardConsoleEnded(card.tabId)
  }
  return ok(card.id, `Closed "${card.title}".`)
}

/** Answers once per requestId; a repeat delivery gets a refusal, never a second action. */
export async function handleBoardCardActionEvent(
  event: BoardCardActionRequest
): Promise<BoardCardActionReply> {
  if (!firstTime(event.requestId)) {
    return {
      requestId: event.requestId,
      ok: false,
      code: 'board_card_action_failed',
      message: 'This request was already handled.'
    }
  }
  try {
    return await act(event)
  } catch (error) {
    return {
      requestId: event.requestId,
      ok: false,
      code: 'board_card_action_failed',
      message: errorText(error)
    }
  }
}

export function resetBoardCardActionHandlerForTest(): void {
  handled.clear()
  restartingSince.clear()
}
