// `boardSpawnConsole` client event (lead loop): main already validated the
// request and checked the worker caps; the renderer launches the agent tab,
// re-checks the caps against its live board, and adds exactly one console card
// per requestId. Same launch + placement path as the orchestrator team spawn.
import { toast } from 'sonner'
import { closeTerminalTab } from '@/components/terminal/terminal-tab-actions'
import { translate } from '@/i18n/i18n'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { useAppStore } from '@/store'
import { getBoard, type BoardState } from '@/store/slices/board'
import { checkWorkerCaps, parseLeadConsoleRole } from '../../../../../shared/lead-caps'
import type { RuntimeBoardSpawnConsoleEvent } from '../../../../../shared/runtime-client-events'
import { isTuiAgent } from '../../../../../shared/tui-agent-config'
import { BOARD_CHROME_INSETS } from '../board-canvas/board-reveal'
import {
  BOARD_CONSOLE_SIZE,
  boardFreeSpawnCenter,
  boardSpawnPlacements
} from '../board-canvas/board-spawn-placement'
import { screenToWorld, type BoardPoint } from '../board-canvas/board-viewport'
import { awaitMirroredConsoleTabs } from '../board-route/board-await-mirrored-tabs'

export type BoardSpawnConsoleOutcome =
  | 'spawned'
  | 'pending-mirror'
  | 'duplicate'
  | 'refused'
  | 'failed'

const HANDLED_LIMIT = 256
const handledRequestIds = new Set<string>()

/** True the first time a requestId is seen; the set is bounded so it never grows unchecked. */
function claimRequest(requestId: string): boolean {
  if (handledRequestIds.has(requestId)) {
    return false
  }
  handledRequestIds.add(requestId)
  if (handledRequestIds.size > HANDLED_LIMIT) {
    const oldest = handledRequestIds.values().next().value
    if (oldest !== undefined) {
      handledRequestIds.delete(oldest)
    }
  }
  return true
}

// Same free-spot rule as BoardRoute.freeCenter / home-open, read from the saved
// board because the Board may not be mounted when the event arrives.
function freeCenter(board: BoardState): BoardPoint {
  const v = board.viewport
  const inset = BOARD_CHROME_INSETS
  const topLeft = screenToWorld({ x: inset.left, y: inset.top }, v)
  const bottomRight = screenToWorld(
    { x: window.innerWidth - inset.right, y: window.innerHeight - inset.bottom },
    v
  )
  return boardFreeSpawnCenter(
    { x: topLeft.x, y: topLeft.y, w: bottomRight.x - topLeft.x, h: bottomRight.y - topLeft.y },
    BOARD_CONSOLE_SIZE,
    board.cards
  )
}

/**
 * Drops the stale console cards main named, but only cards that carry this
 * event's role: the ids come from main's view of the Board and must never be
 * able to remove an unrelated card.
 */
function removeStaleCards(
  board: BoardState,
  worktreeId: string,
  role: string,
  staleIds: readonly string[] | undefined
): void {
  if (!staleIds || staleIds.length === 0) {
    return
  }
  const wanted = new Set(staleIds)
  const stale = board.cards.filter(
    (c) => c.kind === 'console' && c.role === role && wanted.has(c.id)
  )
  if (stale.length === 0) {
    return
  }
  for (const card of stale) {
    if (card.kind === 'console') {
      closeTerminalTab(card.tabId)
    }
  }
  useAppStore.getState().removeCards(
    worktreeId,
    stale.map((c) => c.id)
  )
}

function reportNotStarted(): void {
  toast.error(
    translate('board.spawn.partial', '{{failed}} of {{count}} consoles did not start.', {
      failed: 1,
      count: 1
    })
  )
}

export function handleBoardSpawnConsoleEvent(
  event: RuntimeBoardSpawnConsoleEvent
): BoardSpawnConsoleOutcome {
  if (!claimRequest(event.requestId)) {
    return 'duplicate'
  }
  const role = parseLeadConsoleRole(event.role)
  if (!isTuiAgent(event.agent) || !role) {
    console.warn('boardSpawnConsole refused: bad agent or role', event.requestId)
    return 'refused'
  }
  const { agent, worktreeId } = event
  removeStaleCards(
    getBoard(useAppStore.getState(), worktreeId),
    worktreeId,
    event.role,
    event.replaceStaleCardIds
  )
  const state = useAppStore.getState()
  const board = getBoard(state, worktreeId)
  if (role.kind === 'worker') {
    const check = checkWorkerCaps(
      board.cards.flatMap((c) => (c.kind === 'console' ? [c.role] : [])),
      role.leadId
    )
    if (!check.ok) {
      console.warn('boardSpawnConsole refused: worker cap reached', event.requestId, check)
      return 'refused'
    }
  }
  const knownBefore = new Set((state.tabsByWorktree[worktreeId] ?? []).map((t) => t.id))
  const result = launchAgentInNewTab({
    agent,
    worktreeId,
    ...(event.prompt ? { prompt: event.prompt } : {}),
    promptDelivery: 'submit-after-ready',
    launchSource: 'unknown',
    ...(event.commandOverride ? { agentCommandOverride: event.commandOverride } : {})
  })
  if (!result) {
    reportNotStarted()
    return 'failed'
  }
  const [position] = boardSpawnPlacements(freeCenter(board), 1)
  const card = {
    kind: 'console' as const,
    ...position,
    ...BOARD_CONSOLE_SIZE,
    title: event.title,
    agentKind: agent,
    role: event.role
  }
  if (result.tabId) {
    useAppStore.getState().addCard(worktreeId, { ...card, tabId: result.tabId })
    return 'spawned'
  }
  awaitMirroredConsoleTabs({
    worktreeId,
    agent,
    knownBefore,
    pending: [card],
    onUnbound: reportNotStarted
  })
  return 'pending-mirror'
}

export function resetBoardSpawnConsoleHandlerForTest(): void {
  handledRequestIds.clear()
}
