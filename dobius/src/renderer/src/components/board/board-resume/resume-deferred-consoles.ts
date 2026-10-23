import { closeTerminalTab } from '@/components/terminal/terminal-tab-actions'
import { reconcileTabOrder } from '@/components/tab-bar/reconcile-order'
import { getAgentLaunchPlatformForRepo } from '@/lib/agent-launch-platform'
import { getLocalProjectExecutionRuntimeContext } from '@/lib/local-preflight-context'
import { CLIENT_PLATFORM } from '@/lib/new-workspace'
import { tuiAgentToAgentKind } from '@/lib/telemetry'
import { buildAgentResumeStartupPlan } from '@/lib/tui-agent-startup'
import { useAppStore } from '@/store'
import { getBoard, type BoardCardOf } from '@/store/slices/board'
import {
  resolveTuiAgentLaunchArgs,
  resolveTuiAgentLaunchEnv
} from '../../../../../shared/tui-agent-launch-defaults'
import { markConsolePaused } from '../board-delivery/board-pause'
import { boardConsoleTabIds, livePaneSessions } from './board-resume-gate'
import {
  boardResumeRegistry,
  resumableBoardEntries,
  type DeferredBoardResume
} from './board-resume-registry'

type Console = BoardCardOf<'console'>

function launchPlatform(worktreeId: string): NodeJS.Platform {
  const state = useAppStore.getState()
  const worktree = state.getKnownWorktreeById(worktreeId)
  const repo = worktree ? state.repos.find((entry) => entry.id === worktree.repoId) : null
  if (!repo) {
    return CLIENT_PLATFORM
  }
  return getAgentLaunchPlatformForRepo(
    repo,
    repo.connectionId ? undefined : getLocalProjectExecutionRuntimeContext(state, worktreeId)
  )
}

function appendToTabOrder(worktreeId: string, tabId: string): void {
  const state = useAppStore.getState()
  const base = reconcileTabOrder(
    state.tabBarOrderByWorktree[worktreeId],
    (state.tabsByWorktree[worktreeId] ?? []).map((tab) => tab.id),
    state.openFiles.filter((file) => file.worktreeId === worktreeId).map((file) => file.id),
    (state.browserTabsByWorktree?.[worktreeId] ?? []).map((tab) => tab.id)
  )
  state.setTabBarOrder(worktreeId, [...base.filter((id) => id !== tabId), tabId])
}

// Same swap as a console restart (new tab, card follows it, old tab closes),
// but the new tab launches the parked provider session instead of a fresh one.
function resumeIntoNewTab(worktreeId: string, card: Console, entry: DeferredBoardResume): boolean {
  const state = useAppStore.getState()
  const launchConfig = entry.launchConfig
  const plan = buildAgentResumeStartupPlan({
    agent: entry.agent,
    providerSession: entry.providerSession,
    cmdOverrides: state.settings?.agentCmdOverrides ?? {},
    agentArgs: launchConfig
      ? launchConfig.agentArgs
      : resolveTuiAgentLaunchArgs(entry.agent, state.settings?.agentDefaultArgs),
    agentEnv: launchConfig
      ? launchConfig.agentEnv
      : resolveTuiAgentLaunchEnv(entry.agent, state.settings?.agentDefaultEnv),
    ...(launchConfig?.agentCommand ? { agentCommand: launchConfig.agentCommand } : {}),
    platform: launchPlatform(worktreeId)
  })
  if (!plan) {
    return false
  }
  const tab = state.createTab(worktreeId, undefined, undefined, {
    launchAgent: entry.agent,
    activate: false
  })
  state.queueTabStartupCommand(tab.id, {
    command: plan.launchCommand,
    ...(plan.env ? { env: plan.env } : {}),
    launchConfig: plan.launchConfig,
    resumeProviderSession: entry.providerSession,
    launchAgent: entry.agent,
    ...(plan.startupCommandDelivery ? { startupCommandDelivery: plan.startupCommandDelivery } : {}),
    showSessionRestoredBanner: true,
    telemetry: {
      agent_kind: tuiAgentToAgentKind(entry.agent),
      launch_source: 'unknown',
      request_kind: 'resume'
    }
  })
  appendToTabOrder(worktreeId, tab.id)
  markConsolePaused(card.tabId, false)
  useAppStore.getState().updateCard(worktreeId, card.id, { tabId: tab.id })
  closeTerminalTab(card.tabId)
  return true
}

/** Board consoles that can pick up their last chat right now. */
export function resumableBoardConsoleCount(worktreeId: string): number {
  const state = useAppStore.getState()
  return resumableBoardEntries(
    boardResumeRegistry.pending(worktreeId),
    boardConsoleTabIds(state, worktreeId),
    livePaneSessions(state)
  ).length
}

/** "Yes": resume every parked console's last chat. Returns how many resumed. */
export function resumeDeferredBoardConsoles(worktreeId: string): number {
  const state = useAppStore.getState()
  const entries = resumableBoardEntries(
    boardResumeRegistry.take(worktreeId),
    boardConsoleTabIds(state, worktreeId),
    livePaneSessions(state)
  )
  const cards = getBoard(state, worktreeId).cards
  let resumed = 0
  for (const entry of entries) {
    const card = cards.find((c): c is Console => c.kind === 'console' && c.tabId === entry.tabId)
    if (card && resumeIntoNewTab(worktreeId, card, entry)) {
      resumed += 1
    }
  }
  return resumed
}

/** "No": keep every console on its fresh start. */
export function dismissDeferredBoardConsoles(worktreeId: string): void {
  boardResumeRegistry.take(worktreeId)
}
