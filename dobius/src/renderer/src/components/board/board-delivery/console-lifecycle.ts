import { closeTerminalTab } from '@/components/terminal/terminal-tab-actions'
import { translate } from '@/i18n/i18n'
import { getAgentLabel } from '@/lib/agent-catalog'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { useAppStore } from '@/store'
import { getBoard, type BoardCardOf } from '@/store/slices/board'
import { isTuiAgent } from '../../../../../shared/tui-agent-config'
import type { TuiAgent } from '../../../../../shared/types'
import { BOARD_CONSOLE_SIZE, boardSpawnPlacements } from '../board-canvas/board-spawn-placement'
import type { BoardPoint } from '../board-canvas/board-viewport'
import { isShellProcessName } from '../console-card/console-card-status'
import { markConsolePaused } from './board-pause'

type Console = BoardCardOf<'console'>

export function consoleByName(worktreeId: string, name: string): Console | null {
  const lower = name.toLowerCase()
  return (
    getBoard(useAppStore.getState(), worktreeId).cards.find(
      (c): c is Console => c.kind === 'console' && c.title.toLowerCase() === lower
    ) ?? null
  )
}

export function agentOrDefault(cli: string | null, fallback: TuiAgent = 'claude'): TuiAgent {
  return cli && isTuiAgent(cli) ? cli : fallback
}

/**
 * Spawns `count` consoles with `brief` as their first instruction, placed as a
 * block at `center`. Returns the new card ids (host-backed launches that have
 * no tab yet are skipped and counted as failed).
 */
export function spawnConsoles(input: {
  worktreeId: string
  agent: TuiAgent
  count: number
  brief: string | null
  role: string | null
  center: BoardPoint
}): { cardIds: string[]; failed: number } {
  const state = useAppStore.getState()
  const label = getAgentLabel(input.agent)
  const existing = getBoard(state, input.worktreeId).cards.filter(
    (c) => c.kind === 'console' && c.agentKind === input.agent
  ).length
  const cardIds: string[] = []
  let failed = 0
  boardSpawnPlacements(input.center, input.count).forEach((position, i) => {
    const launched = launchAgentInNewTab({
      agent: input.agent,
      worktreeId: input.worktreeId,
      launchSource: 'unknown',
      ...(input.brief ? { prompt: input.brief, promptDelivery: 'submit-after-ready' as const } : {})
    })
    if (!launched?.tabId) {
      failed += 1
      return
    }
    cardIds.push(
      state.addCard(input.worktreeId, {
        kind: 'console',
        ...position,
        ...BOARD_CONSOLE_SIZE,
        title: `${label} ${existing + i + 1}`,
        tabId: launched.tabId,
        agentKind: input.agent,
        ...(input.role ? { role: input.role } : {})
      })
    )
  })
  return { cardIds, failed }
}

/**
 * Relaunches a console's agent in place: a fresh tab with the same (or a new)
 * agent takes over the card, and the old terminal closes. Why a new tab: it
 * resets the agent cleanly even when the old one is wedged, and the card keeps
 * its position, size, group and wiring because its id does not change.
 */
export function restartConsole(worktreeId: string, card: Console, agent?: TuiAgent): boolean {
  const next = agent ?? agentOrDefault(card.agentKind)
  const launched = launchAgentInNewTab({ agent: next, worktreeId, launchSource: 'unknown' })
  if (!launched?.tabId) {
    return false
  }
  const oldTab = card.tabId
  markConsolePaused(oldTab, false)
  useAppStore.getState().updateCard(worktreeId, card.id, { tabId: launched.tabId, agentKind: next })
  closeTerminalTab(oldTab)
  return true
}

/** True when the console has ended: tab gone or back at a bare shell. */
export async function isConsoleEnded(card: Console): Promise<boolean> {
  const state = useAppStore.getState()
  const tabExists = Object.values(state.tabsByWorktree).some((tabs) =>
    tabs.some((t) => t.id === card.tabId)
  )
  if (!tabExists) {
    return true
  }
  // Why: a live tab with no PTY yet is still spawning (or sleeping); treating it as ended let clean_board close it.
  const ptyId = state.ptyIdsByTabId[card.tabId]?.[0]
  if (!ptyId) {
    return false
  }
  try {
    return isShellProcessName(await window.api.pty.getForegroundProcess(ptyId))
  } catch {
    return false
  }
}

/** Closes only ended consoles; live ones are untouched. */
export async function cleanDeadLanes(worktreeId: string): Promise<string[]> {
  const consoles = getBoard(useAppStore.getState(), worktreeId).cards.filter(
    (c): c is Console => c.kind === 'console'
  )
  const ended: Console[] = []
  for (const c of consoles) {
    if (await isConsoleEnded(c)) {
      ended.push(c)
    }
  }
  for (const c of ended) {
    closeTerminalTab(c.tabId)
  }
  useAppStore.getState().removeCards(
    worktreeId,
    ended.map((c) => c.id)
  )
  return ended.map((c) => c.title)
}

export function cleanResultText(names: readonly string[]): string {
  return names.length === 0
    ? translate('board.clean.none', 'No ended consoles to close.')
    : translate('board.clean.done', 'Closed {{count}} ended console(s): {{names}}.', {
        count: names.length,
        names: names.join(', ')
      })
}
