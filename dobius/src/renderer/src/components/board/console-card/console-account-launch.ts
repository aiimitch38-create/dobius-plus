import { useAppStore } from '@/store'
import { CLIENT_PLATFORM } from '@/lib/new-workspace'
import {
  buildPinnedAgentCommand,
  isConsoleAccountAgent,
  supportsConsoleAccountPin,
  type ConsoleAccountLaunch
} from '../../../../../shared/console-account'
import { getTuiAgentLaunchCommand, TUI_AGENT_CONFIG } from '../../../../../shared/tui-agent-config'
import type { TuiAgent } from '../../../../../shared/types'

export type PinnedAgentCommand = { command: string; launch: ConsoleAccountLaunch }

/** The base command the launch would use without a pin (user override wins). */
export function baseAgentCommand(
  agent: TuiAgent,
  cmdOverrides: Partial<Record<TuiAgent, string>>,
  platform: NodeJS.Platform
): string {
  return cmdOverrides[agent]?.trim() || getTuiAgentLaunchCommand(TUI_AGENT_CONFIG[agent], platform)
}

export function isWorktreeRemote(worktreeId: string): boolean {
  const state = useAppStore.getState()
  const worktree = state.allWorktrees?.().find((entry: { id: string }) => entry.id === worktreeId)
  const repo = worktree ? state.repos?.find((entry) => entry.id === worktree.repoId) : null
  return Boolean(repo?.connectionId)
}

export function canPinConsoleAccount(worktreeId: string, agent: string): boolean {
  return (
    isConsoleAccountAgent(agent) &&
    supportsConsoleAccountPin(CLIENT_PLATFORM, isWorktreeRemote(worktreeId))
  )
}

/**
 * Prepares the account's console profile in main and returns the launch command
 * that runs the agent inside it. Throws when the account cannot be pinned, so a
 * caller never silently falls back to a different account.
 */
export async function resolvePinnedAgentCommand(
  worktreeId: string,
  agent: TuiAgent,
  accountId: string
): Promise<PinnedAgentCommand> {
  if (!isConsoleAccountAgent(agent) || !canPinConsoleAccount(worktreeId, agent)) {
    throw new Error('This console cannot use a separate account.')
  }
  const launch = await window.api.consoleAccounts.prepare({ agent, accountId })
  const overrides = useAppStore.getState().settings?.agentCmdOverrides ?? {}
  const base = baseAgentCommand(agent, overrides, CLIENT_PLATFORM)
  return { command: buildPinnedAgentCommand(base, launch.envVar, launch.configDir), launch }
}
