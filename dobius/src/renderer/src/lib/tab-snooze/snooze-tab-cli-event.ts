// `dobius tabs snooze`: main asks this window to snooze one terminal tab. It
// runs the same runTabSnooze the tab menu uses (main saves the tab and its
// conversation first, then the tab closes). Why a separate entry point: the
// menu opens a confirm dialog for a tab whose agent is mid-turn; a CLI caller
// gets a refusal instead (or passes --force), so nothing pops up on screen.
import { useAppStore } from '@/store'
import type { TabSnoozeCliReply, TabSnoozeCliRequest } from '../../../../shared/tab-snooze-cli'
import type { SnoozeTabDeps, SnoozeTabOutcome } from './snooze-terminal-tab'
import { runTabSnooze, snoozeTerminalTabDeps } from './snooze-terminal-tab'

const OUTCOME_TEXT: Partial<Record<SnoozeTabOutcome, [code: string, message: string]>> = {
  missing: ['tab_not_found', 'No terminal tab with that id is open in this window.'],
  'tab-gone': ['tab_not_found', 'The tab closed while it was being snoozed; it was not kept.'],
  'needs-confirm': [
    'tab_agent_working',
    'Its agent is working right now. Pass --force to stop its turn and snooze it.'
  ],
  'split-panes': ['tab_snooze_refused', 'Snooze works on tabs with one pane. Close the extra panes first.'],
  'conversation-not-resumable': [
    'tab_snooze_refused',
    'This conversation cannot be saved for later yet. Try again in a moment.'
  ],
  full: ['tab_snooze_refused', 'The Snoozed shelf is full. Bring a tab back or close one for good first.'],
  invalid: ['tab_snooze_refused', 'This tab could not be snoozed.'],
  unavailable: ['tab_snooze_unavailable', 'Snoozing is not available in this window.']
}

const HANDLED_LIMIT = 256
const handled = new Set<string>()

function firstTime(requestId: string): boolean {
  if (handled.has(requestId)) {
    return false
  }
  handled.add(requestId)
  if (handled.size > HANDLED_LIMIT) {
    const oldest = handled.values().next().value
    if (oldest !== undefined) {
      handled.delete(oldest)
    }
  }
  return true
}

function worktreeOfTab(tabId: string): string | null {
  for (const [worktreeId, tabs] of Object.entries(useAppStore.getState().tabsByWorktree)) {
    if (tabs.some((tab) => tab.id === tabId)) {
      return worktreeId
    }
  }
  return null
}

export async function handleTabSnoozeCliEvent(
  event: TabSnoozeCliRequest,
  deps: SnoozeTabDeps = snoozeTerminalTabDeps()
): Promise<TabSnoozeCliReply> {
  const { requestId, tabId } = event
  if (!firstTime(requestId)) {
    return { requestId, ok: false, code: 'tab_snooze_refused', message: 'This request was already handled.' }
  }
  const worktreeId = worktreeOfTab(tabId)
  const until = typeof event.until === 'number' && Number.isFinite(event.until) ? event.until : null
  // Why a no-op confirm: a CLI caller must never open a dialog on Carson's screen.
  const quiet: SnoozeTabDeps = {
    ...deps,
    getState: () => ({ ...deps.getState(), setSnoozeTabConfirm: () => undefined })
  }
  try {
    const outcome = await runTabSnooze(quiet, tabId, until, { confirmed: event.force === true })
    if (outcome === 'snoozed' && worktreeId) {
      return { requestId, ok: true, worktreeId, tabId }
    }
    const [code, message] = OUTCOME_TEXT[outcome] ?? ['tab_snooze_refused', `Not snoozed (${outcome}).`]
    return { requestId, ok: false, code, message }
  } catch (error) {
    return {
      requestId,
      ok: false,
      code: 'tab_snooze_refused',
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export function resetTabSnoozeCliHandlerForTest(): void {
  handled.clear()
}
