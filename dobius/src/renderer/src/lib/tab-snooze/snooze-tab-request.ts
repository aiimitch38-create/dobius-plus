import type { SleepingAgentSessionRecord } from '../../../../shared/agent-session-resume'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import type { SnoozeTabRequest } from '../../../../shared/tab-snooze-types'
import type { Tab, TerminalLayoutSnapshot, TerminalTab } from '../../../../shared/types'

export type SnoozeTabPlan =
  | {
      ok: true
      request: SnoozeTabRequest
      /** The agent is in the middle of a turn: ask before stopping it. */
      working: boolean
      /** The tab comes back on the same conversation (never as a plain shell). */
      resumes: boolean
      label: string
    }
  | { ok: false; reason: 'split-panes' }

type PaneStatus = { paneKey: string; state: string }

export function terminalTabLabel(tab: TerminalTab): string {
  return (
    tab.customTitle?.trim() ||
    tab.generatedTitle?.trim() ||
    tab.quickCommandLabel?.trim() ||
    tab.title?.trim() ||
    tab.defaultTitle?.trim() ||
    'Tab'
  )
}

function paneBelongsToTab(paneKey: string, tabId: string): boolean {
  return parsePaneKey(paneKey)?.tabId === tabId
}

/**
 * Pure: what snoozing this tab would save. One pane only: a snoozed tab comes
 * back as one terminal on one conversation, and a split tab would lose the
 * panes that are not the conversation's.
 */
export function planTabSnooze(args: {
  tab: TerminalTab
  unifiedTab?: Pick<Tab, 'isPinned' | 'viewMode'> | null
  layout?: TerminalLayoutSnapshot | null
  /** Captured conversations for the tab's worktree, keyed by pane. */
  agentSessions: Readonly<Record<string, SleepingAgentSessionRecord>>
  /** Live agent rows, to tell whether the tab is mid-turn. */
  paneStatuses: readonly PaneStatus[]
  until: number | null
}): SnoozeTabPlan {
  const { tab, layout } = args
  if (layout?.root && layout.root.type !== 'leaf') {
    return { ok: false, reason: 'split-panes' }
  }
  const leafId = layout?.root?.type === 'leaf' ? layout.root.leafId : null
  const agentSession =
    Object.values(args.agentSessions)
      .filter((record) => paneBelongsToTab(record.paneKey, tab.id))
      .sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null
  const working = args.paneStatuses.some(
    (status) => status.state === 'working' && paneBelongsToTab(status.paneKey, tab.id)
  )
  const label = terminalTabLabel(tab)
  const scrollback = leafId ? (layout?.buffersByLeafId?.[leafId] ?? null) : null
  return {
    ok: true,
    working,
    resumes: Boolean(agentSession),
    label,
    request: {
      worktreeId: tab.worktreeId,
      tabId: tab.id,
      until: args.until,
      title: label,
      customTitle: tab.customTitle,
      color: tab.color,
      pinned: Boolean(args.unifiedTab?.isPinned ?? tab.isPinned),
      viewMode: args.unifiedTab?.viewMode ?? tab.viewMode,
      launchAgent: tab.launchAgent ?? null,
      startupCwd: tab.startupCwd ?? null,
      shellOverride: tab.shellOverride ?? null,
      agentSession,
      preview: agentSession?.lastAssistantMessage ?? agentSession?.prompt ?? null,
      scrollback
    }
  }
}
