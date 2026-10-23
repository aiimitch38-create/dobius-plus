import {
  CONSOLE_ACCOUNT_AGENTS,
  type ConsoleAccountAgent
} from '../../../../../shared/console-account'
import type {
  ClaudeRateLimitAccountsState,
  CodexRateLimitAccountsState
} from '../../../../../shared/types'

export type ConsoleAccountsSnapshot = {
  claude: ClaudeRateLimitAccountsState | null
  codex: CodexRateLimitAccountsState | null
}

export type ConsoleAccountOption = {
  agent: ConsoleAccountAgent
  /** null = no pin: the console follows the Settings default (today's behavior). */
  accountId: string | null
  email: string | null
  current: boolean
}

type HostAccount = { id: string; email: string }

function hostAccounts(
  agent: ConsoleAccountAgent,
  snapshot: ConsoleAccountsSnapshot
): { accounts: HostAccount[]; defaultId: string | null } {
  if (agent === 'claude') {
    const state = snapshot.claude
    return {
      accounts: (state?.accounts ?? []).filter((a) => a.managedAuthRuntime !== 'wsl'),
      defaultId: state?.activeAccountIdsByRuntime?.host ?? state?.activeAccountId ?? null
    }
  }
  const state = snapshot.codex
  return {
    accounts: (state?.accounts ?? []).filter((a) => a.managedHomeRuntime !== 'wsl'),
    defaultId: state?.activeAccountIdsByRuntime?.host ?? state?.activeAccountId ?? null
  }
}

/**
 * Account rows for the console badge: per detected Claude/Codex CLI, one
 * "Default" row (follows Settings) plus one row per host managed account.
 */
export function buildConsoleAccountOptions(input: {
  snapshot: ConsoleAccountsSnapshot
  detected: readonly string[]
  currentAgent: string
  currentAccountId: string | null | undefined
}): ConsoleAccountOption[] {
  const options: ConsoleAccountOption[] = []
  for (const agent of CONSOLE_ACCOUNT_AGENTS) {
    if (!input.detected.includes(agent)) {
      continue
    }
    const { accounts, defaultId } = hostAccounts(agent, input.snapshot)
    const isCurrentAgent = input.currentAgent === agent
    const currentId = input.currentAccountId ?? null
    options.push({
      agent,
      accountId: null,
      email: accounts.find((a) => a.id === defaultId)?.email ?? null,
      current: isCurrentAgent && currentId === null
    })
    for (const account of accounts) {
      options.push({
        agent,
        accountId: account.id,
        email: account.email,
        current: isCurrentAgent && currentId === account.id
      })
    }
  }
  return options
}

/** Email shown on the badge for a pinned console, or null when it follows Settings. */
export function pinnedAccountEmail(
  snapshot: ConsoleAccountsSnapshot,
  agent: string,
  accountId: string | null | undefined
): string | null {
  if (!accountId || (agent !== 'claude' && agent !== 'codex')) {
    return null
  }
  return hostAccounts(agent, snapshot).accounts.find((a) => a.id === accountId)?.email ?? null
}
