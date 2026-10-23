import { useAppStore } from '@/store'
import { AGENT_STATUS_STALE_AFTER_MS } from '../../../../../shared/agent-status-types'
import { consoleCardStatus, type ConsoleCardStatus } from './console-card-status'
import { useConsolePane } from './use-console-pane'
import { useConsoleForeground, useConsolePaused } from './use-console-runtime'

export type ConsoleCardLiveStatus = {
  status: ConsoleCardStatus
  /** The agent's last full reply from the hook feed, or null before its first turn ends. */
  lastReply: { text: string; at: number } | null
}

/** One console's live status, shared by the card header, Mission Map and orchestrator rows. */
export function useConsoleCardStatus(worktreeId: string, tabId: string): ConsoleCardLiveStatus {
  const { tabExists, paneKey } = useConsolePane(worktreeId, tabId)
  const entry = useAppStore((s) => (paneKey ? s.agentStatusByPaneKey[paneKey] : undefined))
  const sleeping = useAppStore((s) =>
    paneKey ? Boolean(s.sleepingAgentSessionsByPaneKey[paneKey]) : false
  )
  const boardPaused = useConsolePaused(tabId)
  const foreground = useConsoleForeground(tabId)
  // Why: subscribing to the epoch re-evaluates staleness when the feed ticks.
  useAppStore((s) => s.agentStatusEpoch)
  const status = consoleCardStatus({
    tabExists,
    paused: sleeping || boardPaused,
    foreground,
    entry,
    now: Date.now(),
    staleAfterMs: AGENT_STATUS_STALE_AFTER_MS
  })
  const text = entry?.lastAssistantMessage?.trim()
  return { status, lastReply: text ? { text, at: entry?.updatedAt ?? Date.now() } : null }
}
