import { useAppStore } from '@/store'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'

/** Tags the dock's agent-chat tab within the floating terminal workspace, so
 *  later opens reuse the same session instead of spinning up a new one. */
export const FLOATING_TERMINAL_AGENT_TAB_LABEL = 'Dobius Agent Chat'

/**
 * Finds or starts the dock's agent-chat tab, always forced into chat view
 * (`NativeChatView`) regardless of the user's global chat-by-default setting —
 * this tab exists specifically to be the dock's chat surface. It's a real tab
 * in the real floating terminal workspace: the underlying terminal is one
 * view-mode switch away, never a separate hidden session elsewhere.
 */
export async function ensureFloatingTerminalAgentTab(): Promise<string | null> {
  const store = useAppStore.getState()
  const existing = (store.tabsByWorktree[FLOATING_TERMINAL_WORKTREE_ID] ?? []).find(
    (tab) => tab.quickCommandLabel === FLOATING_TERMINAL_AGENT_TAB_LABEL
  )
  const tabId =
    existing?.id ??
    launchAgentInNewTab({
      agent: 'claude',
      worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
      launchSource: 'shortcut',
      quickCommandLabel: FLOATING_TERMINAL_AGENT_TAB_LABEL
    })?.tabId
  if (!tabId) {
    return null
  }
  const fresh = useAppStore.getState()
  fresh.setTabViewMode(tabId, 'chat')
  fresh.activateTab(tabId)
  fresh.setActiveTab(tabId)
  focusTerminalTabSurface(tabId)
  return tabId
}
