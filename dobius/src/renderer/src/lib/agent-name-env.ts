import type { AppState } from '@/store/types'

/**
 * Why: an agent should know the name Carson and ADAM call it by, so it can
 * answer to "Juniper" and sign its messages. Tabs created before agent names
 * existed get nothing rather than a made-up name that the tab does not show.
 */
export function agentNameEnv(
  state: Pick<AppState, 'tabsByWorktree'>,
  worktreeId: string,
  tabId: string
): Record<string, string> {
  const tab = (state.tabsByWorktree?.[worktreeId] ?? []).find((entry) => entry.id === tabId)
  // Why: env values travel through shells and WSLENV; keep the name one line.
  const name = tab?.agentName?.replace(/\p{Cc}+/gu, ' ').trim()
  return name ? { DOBIUS_AGENT_NAME: name } : {}
}
