// `dobius tabs snooze|unsnooze|snoozed`: what main asks the window to do and
// what the CLI is allowed to see. Snoozing runs in the window (it reads the
// tab's conversation while the terminal is alive, then closes the tab), so
// main asks it; bringing back runs through main's snooze list, whose take() is
// the one claim gate (an entry is handed out once, never resumed twice).
import type { SnoozedTabEntry } from './tab-snooze-types'

/** Main asks the window to snooze one terminal tab. */
export type TabSnoozeCliRequest = {
  requestId: string
  tabId: string
  /** When it comes back (ms), or null for "until I bring it back". */
  until: number | null
  /** Snooze even while the tab's agent is mid-turn (the turn stops). */
  force?: boolean
}

export type TabSnoozeCliReply =
  | { requestId: string; ok: true; worktreeId: string; tabId: string }
  | { requestId: string; ok: false; code: string; message: string }

/** One snoozed tab as the CLI shows it: no resume tokens, no saved output. */
export type SnoozedTabSummary = {
  worktreeId: string
  tabId: string
  title: string
  snoozedAt: number
  until: number | null
  ready: boolean
  /** A window is bringing it back right now. */
  returning: boolean
  pinned: boolean
  agent: string | null
  /** It will resume an agent conversation when it comes back. */
  hasConversation: boolean
}

export function summarizeSnoozedTab(entry: SnoozedTabEntry): SnoozedTabSummary {
  return {
    worktreeId: entry.worktreeId,
    tabId: entry.tabId,
    title: entry.customTitle ?? entry.title,
    snoozedAt: entry.snoozedAt,
    until: entry.until,
    ready: entry.ready,
    returning: entry.returning === true,
    pinned: entry.pinned === true,
    agent: entry.agentSession?.agent ?? entry.launchAgent ?? null,
    hasConversation: Boolean(entry.agentSession)
  }
}

/** Furthest a CLI snooze may reach; anything longer is "until I bring it back". */
export const TAB_SNOOZE_CLI_MAX_MS = 365 * 24 * 60 * 60 * 1000
