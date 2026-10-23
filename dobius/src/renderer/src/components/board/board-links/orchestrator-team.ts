// "+" and "grow the team to N" on an orchestrator card: spawn consoles that
// start out wired to the card. Same launch path as the Board's spawn chip.
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { getAgentLabel } from '@/lib/agent-catalog'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { useAppStore } from '@/store'
import { getBoard, type BoardCardOf, type BoardState } from '@/store/slices/board'
import type { TuiAgent } from '../../../../../shared/types'
import { BOARD_CONSOLE_SIZE, boardSpawnPlacements } from '../board-canvas/board-spawn-placement'
import { awaitMirroredConsoleTabs } from '../board-route/board-await-mirrored-tabs'

export const MAX_TEAM_SIZE = 12
const TEAM_GAP = 80

/** Wired consoles still on the board. */
export function wiredConsoleCount(
  board: BoardState,
  orchestrator: BoardCardOf<'orchestrator'>
): number {
  const wired = new Set(orchestrator.wiredCardIds)
  return board.cards.filter((c) => c.kind === 'console' && wired.has(c.id)).length
}

/** How many consoles to add to reach `target`, capped at MAX_TEAM_SIZE. */
export function teamGrowth(current: number, target: number): number {
  if (!Number.isFinite(target)) {
    return 0
  }
  const goal = Math.min(MAX_TEAM_SIZE, Math.max(0, Math.floor(target)))
  return Math.max(0, goal - current)
}

/** Next agent when the team-agent chip is clicked (wraps; unknown current = first). */
export function nextTeamAgent(
  options: readonly string[],
  current: string | undefined
): string | undefined {
  if (options.length === 0) {
    return current
  }
  const index = current ? options.indexOf(current) : -1
  return options[(index + 1) % options.length]
}

/** Centre for new team consoles: to the right of the orchestrator card. */
export function teamSpawnCenter(
  orchestrator: Pick<BoardCardOf<'orchestrator'>, 'x' | 'y' | 'w' | 'h'>,
  count: number
): { x: number; y: number } {
  const columns = Math.min(2, Math.max(1, count))
  const blockW = columns * BOARD_CONSOLE_SIZE.w + (columns - 1) * 32
  return {
    x: orchestrator.x + orchestrator.w + TEAM_GAP + blockW / 2,
    y: orchestrator.y + orchestrator.h / 2
  }
}

export function spawnWiredConsoles(
  worktreeId: string,
  orchestratorId: string,
  agent: TuiAgent,
  count: number
): void {
  const state = useAppStore.getState()
  const board = getBoard(state, worktreeId)
  const orchestrator = board.cards.find((c) => c.id === orchestratorId)
  if (orchestrator?.kind !== 'orchestrator' || count <= 0) {
    return
  }
  const label = getAgentLabel(agent)
  const existing = board.cards.filter((c) => c.kind === 'console' && c.agentKind === agent).length
  const knownBefore = new Set((state.tabsByWorktree[worktreeId] ?? []).map((t) => t.id))
  const awaiting: Parameters<typeof awaitMirroredConsoleTabs>[0]['pending'] = []
  const newIds: string[] = []
  let failed = 0
  boardSpawnPlacements(teamSpawnCenter(orchestrator, count), count).forEach((position, index) => {
    const result = launchAgentInNewTab({ agent, worktreeId, launchSource: 'unknown' })
    if (!result) {
      failed += 1
      return
    }
    // Why: the id is chosen up front so the card is wired even when a host-backed
    // launch places it later (await mirrored tabs).
    const id = crypto.randomUUID()
    newIds.push(id)
    const card = {
      id,
      kind: 'console' as const,
      ...position,
      ...BOARD_CONSOLE_SIZE,
      title: `${label} ${existing + index + 1}`,
      agentKind: agent
    }
    if (result.tabId) {
      useAppStore.getState().addCard(worktreeId, { ...card, tabId: result.tabId })
    } else {
      awaiting.push(card)
    }
  })
  if (newIds.length > 0) {
    const current = getBoard(useAppStore.getState(), worktreeId).cards.find(
      (c) => c.id === orchestratorId
    )
    if (current?.kind === 'orchestrator') {
      useAppStore.getState().updateCard(worktreeId, orchestratorId, {
        wiredCardIds: [...current.wiredCardIds, ...newIds]
      })
    }
  }
  const reportFailed = (n: number): void => {
    toast.error(
      translate('board.spawn.partial', '{{failed}} of {{count}} consoles did not start.', {
        failed: n,
        count
      })
    )
  }
  if (failed > 0) {
    reportFailed(failed)
  }
  if (awaiting.length > 0) {
    awaitMirroredConsoleTabs({
      worktreeId,
      agent,
      knownBefore,
      pending: awaiting,
      onUnbound: reportFailed
    })
  }
}
