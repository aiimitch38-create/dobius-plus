import type { AppState } from '@/store/types'

/**
 * A new console card's title: the name its terminal tab was given ("Juniper"),
 * so the card, the tab and ADAM all use one name. Falls back (e.g. "Claude 3")
 * when the tab is not in the store yet or predates agent names.
 */
export function consoleTitleForTab(
  state: Pick<AppState, 'tabsByWorktree'>,
  tabId: string | null | undefined,
  fallback: string
): string {
  if (!tabId) {
    return fallback
  }
  for (const tabs of Object.values(state.tabsByWorktree)) {
    const tab = tabs.find((entry) => entry.id === tabId)
    if (tab) {
      return tab.customTitle?.trim() || tab.agentName?.trim() || fallback
    }
  }
  return fallback
}
