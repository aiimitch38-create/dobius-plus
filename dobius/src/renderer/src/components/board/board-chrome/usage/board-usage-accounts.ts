import { useAppStore } from '@/store'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { getAgentLabel } from '@/lib/agent-catalog'
import { getBoard } from '@/store/slices/board'
import type { ConsoleAccountAgent, ConsoleAccountLaunch } from '../../../../../../shared/console-account'
import { BOARD_CHROME_INSETS } from '../../board-canvas/board-reveal'
import {
  BOARD_CONSOLE_SIZE,
  boardFreeSpawnCenter,
  boardSpawnPlacements
} from '../../board-canvas/board-spawn-placement'
import { screenToWorld } from '../../board-canvas/board-viewport'
import { resolvePinnedAgentCommand } from '../../console-card/console-account-launch'
import type { ConsoleAccountsSnapshot } from '../../console-card/console-account-options'

export type AccountProfileRow = {
  /** null = the system login (no managed profile). */
  accountId: string | null
  email: string | null
  active: boolean
}

/**
 * Host profiles for one agent, system login first. "Active" is the Settings
 * default that new lanes without a pin run as (host runtime).
 */
export function accountProfileRows(
  snapshot: ConsoleAccountsSnapshot,
  agent: ConsoleAccountAgent
): AccountProfileRow[] {
  const accounts =
    agent === 'claude'
      ? (snapshot.claude?.accounts ?? []).filter((a) => a.managedAuthRuntime !== 'wsl')
      : (snapshot.codex?.accounts ?? []).filter((a) => a.managedHomeRuntime !== 'wsl')
  const state = agent === 'claude' ? snapshot.claude : snapshot.codex
  const activeId = state?.activeAccountIdsByRuntime?.host ?? state?.activeAccountId ?? null
  return [
    { accountId: null, email: null, active: activeId === null },
    ...accounts.map((a) => ({ accountId: a.id, email: a.email, active: a.id === activeId }))
  ]
}

export class NoBoardError extends Error {
  constructor() {
    super('No workspace board is open.')
    this.name = 'NoBoardError'
  }
}

// Same free-spot rule the Board uses for spawns (BoardRoute.freeCenter).
function freeCenterFor(worktreeId: string): { x: number; y: number } {
  const board = getBoard(useAppStore.getState(), worktreeId)
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
 * Drops one console for `agent` on the active board, pinned to `accountId`
 * when given (the existing per-console profile path). The first launch on a
 * profile that has never signed in runs the CLI's own sign-in inside the lane.
 */
export async function openAccountLane(
  agent: ConsoleAccountAgent,
  accountId: string | null
): Promise<{ launch: ConsoleAccountLaunch | null }> {
  const state = useAppStore.getState()
  const worktreeId = state.activeWorktreeId
  if (!worktreeId) {
    throw new NoBoardError()
  }
  const pinned = accountId ? await resolvePinnedAgentCommand(worktreeId, agent, accountId) : null
  const launched = launchAgentInNewTab({
    agent,
    worktreeId,
    launchSource: 'unknown',
    ...(pinned ? { agentCommandOverride: pinned.command } : {})
  })
  if (!launched?.tabId) {
    throw new Error(`${getAgentLabel(agent)} could not be launched.`)
  }
  const existing = getBoard(state, worktreeId).cards.filter(
    (c) => c.kind === 'console' && c.agentKind === agent
  ).length
  const [position] = boardSpawnPlacements(freeCenterFor(worktreeId), 1)
  state.addCard(worktreeId, {
    kind: 'console',
    ...position,
    ...BOARD_CONSOLE_SIZE,
    title: `${getAgentLabel(agent)} ${existing + 1}`,
    tabId: launched.tabId,
    agentKind: agent,
    ...(accountId ? { accountId } : {})
  })
  return { launch: pinned?.launch ?? null }
}
