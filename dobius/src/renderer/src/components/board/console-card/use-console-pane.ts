import { useAppStore } from '@/store'
import { isTerminalLeafId, makePaneKey } from '../../../../../shared/stable-pane-id'
import { resolveConsoleLeafId } from './console-card-status'

export type ConsolePane = { tabExists: boolean; leafId: string | null; paneKey: string | null }

// Why: the leaf UUID only exists once the tab's layout is published; until
// then the card shows "Starting" instead of guessing a numeric pane id.
export function useConsolePane(worktreeId: string, tabId: string): ConsolePane {
  const tabExists = useAppStore((s) =>
    (s.tabsByWorktree[worktreeId] ?? []).some((t) => t.id === tabId)
  )
  const leafId = useAppStore((s) => resolveConsoleLeafId(s.terminalLayoutsByTabId[tabId]))
  const paneKey =
    leafId && isTerminalLeafId(leafId) && !tabId.includes(':') ? makePaneKey(tabId, leafId) : null
  return { tabExists, leafId, paneKey }
}
