import { toast } from 'sonner'
import { closeTerminalTab } from '@/components/terminal/terminal-tab-actions'
import { translate } from '@/i18n/i18n'
import { getAgentLabel } from '@/lib/agent-catalog'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { useAppStore } from '@/store'
import { getBoard, type BoardCardOf } from '@/store/slices/board'
import {
  bugFixClaudeArgs,
  isBugFixProfileLaunch,
  isBugFixWorktreePath
} from '../../../../../shared/bug-fix-agent-profile'
import { isTuiAgent } from '../../../../../shared/tui-agent-config'
import type { TuiAgent } from '../../../../../shared/types'
import { boardSpawnRects } from '../board-canvas/board-spawn-placement'
import type { BoardPoint } from '../board-canvas/board-viewport'
import {
  boardGhostOf,
  pushBoardGhosts,
  type BoardGhostSpec
} from '../board-canvas/board-ghost-store'
import { clearBoardConsoleEnded, isBoardConsoleEnded } from '../console-card/board-console-exit'
import { isShellProcessName } from '../console-card/console-card-status'
import { resolvePinnedAgentCommand } from '../console-card/console-account-launch'
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
  const ghosts: BoardGhostSpec[] = []
  let failed = 0
  boardSpawnRects(input.center, input.count).forEach((rect, i) => {
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
    const card = {
      kind: 'console' as const,
      ...rect,
      title: `${label} ${existing + i + 1}`,
      tabId: launched.tabId,
      agentKind: input.agent,
      ...(input.role ? { role: input.role } : {})
    }
    const cardId = state.addCard(input.worktreeId, card)
    cardIds.push(cardId)
    ghosts.push(boardGhostOf(card, cardId))
  })
  pushBoardGhosts(ghosts)
  return { cardIds, failed }
}

/**
 * Relaunches a console's agent in place: a fresh tab with the same (or a new)
 * agent takes over the card, and the old terminal closes. Why a new tab: it
 * resets the agent cleanly even when the old one is wedged, and the card keeps
 * its position, size, group and wiring because its id does not change.
 */
export type ConsoleRelaunchOptions = {
  /** Base command for this launch (a pinned account's env prefix). */
  agentCommandOverride?: string
  /** Account the new launch is pinned to; null clears the pin. */
  accountId?: string | null
}

type RestrictedLaunch = { command: string; args: string }

/** How to relaunch a bug-fix console, or null for any other console. Why two
 *  signals: the captured launch (keeps --add-dir) is dropped when the agent
 *  exits, but the workspace folder name never changes. */
function restrictedLaunchFor(worktreeId: string, tabId: string): RestrictedLaunch | null {
  const state = useAppStore.getState()
  for (const [paneKey, entry] of Object.entries(state.agentLaunchConfigByPaneKey ?? {})) {
    const command = entry.launchConfig.agentCommand
    if (paneKey.startsWith(`${tabId}:`) && command && isBugFixProfileLaunch(command)) {
      return { command, args: '' }
    }
  }
  const worktree = state.allWorktrees?.().find((entry) => entry.id === worktreeId)
  return isBugFixWorktreePath(worktree?.path) ? { command: 'claude', args: bugFixClaudeArgs() } : null
}

export function restartConsole(
  worktreeId: string,
  card: Console,
  agent?: TuiAgent,
  launch?: ConsoleRelaunchOptions
): boolean {
  // Why: a bug-fix console must come back with its captured restricted
  // command, never the Settings default args (which skip permissions) or
  // another agent.
  const restricted = restrictedLaunchFor(worktreeId, card.tabId)
  if (restricted) {
    return relaunchInNewTab(worktreeId, card, 'claude', restricted.command, restricted.args, undefined)
  }
  const next = agent ?? agentOrDefault(card.agentKind)
  // Why: a plain restart of a pinned console must stay on its account; falling
  // back to the Settings default would silently switch who the agent runs as.
  if (!launch && card.accountId && next === card.agentKind) {
    const accountId = card.accountId
    void resolvePinnedAgentCommand(worktreeId, next, accountId).then(
      (pinned) =>
        restartConsole(worktreeId, card, next, { agentCommandOverride: pinned.command, accountId }),
      (error: unknown) =>
        toast.error(
          translate(
            'board.console.accountRelaunchFailed',
            'Could not relaunch on that account: {{reason}}',
            {
              reason: error instanceof Error ? error.message : String(error)
            }
          )
        )
    )
    return true
  }
  const accountId = launch?.agentCommandOverride ? (launch.accountId ?? undefined) : undefined
  return relaunchInNewTab(worktreeId, card, next, launch?.agentCommandOverride, undefined, accountId)
}

function relaunchInNewTab(
  worktreeId: string,
  card: Console,
  next: TuiAgent,
  agentCommandOverride: string | undefined,
  agentArgs: string | undefined,
  accountId: string | undefined
): boolean {
  const launched = launchAgentInNewTab({
    agent: next,
    worktreeId,
    launchSource: 'unknown',
    ...(agentCommandOverride ? { agentCommandOverride } : {}),
    // Why explicit args: they replace the Settings default args entirely
    // ('' when a captured command already carries its own).
    ...(agentArgs !== undefined ? { agentArgs } : {})
  })
  if (!launched?.tabId) {
    return false
  }
  const oldTab = card.tabId
  markConsolePaused(oldTab, false)
  useAppStore
    .getState()
    .updateCard(worktreeId, card.id, { tabId: launched.tabId, agentKind: next, accountId })
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
  // Why: a live tab with no PTY is still spawning (or sleeping) unless its PTY
  // exited under the card (kept mounted as "Ended"); only that one is ended.
  const ptyId = state.ptyIdsByTabId[card.tabId]?.[0]
  if (!ptyId) {
    return isBoardConsoleEnded(card.tabId)
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
    clearBoardConsoleEnded(c.tabId)
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
