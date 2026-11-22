import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { closeTerminalTab } from '@/components/terminal/terminal-tab-actions'
import { shutdownBufferCaptures } from '@/components/terminal-pane/shutdown-buffer-captures'
import { collectSleepingAgentSessionRecordsForWorktree } from '@/store/slices/agent-status'
import type { SnoozeTabResult } from '../../../../shared/tab-snooze-types'
import type { AppState } from '@/store/types'
import type { PreloadApi } from '../../../../preload/api-types'
import { planTabSnooze } from './snooze-tab-request'

export type SnoozeTabOutcome =
  | 'snoozed'
  | 'needs-confirm'
  | 'missing'
  | 'tab-gone'
  | 'in-progress'
  | 'split-panes'
  | 'unavailable'
  | Extract<SnoozeTabResult, { ok: false }>['reason']

type SnoozeState = Pick<
  AppState,
  | 'tabsByWorktree'
  | 'unifiedTabsByWorktree'
  | 'terminalLayoutsByTabId'
  | 'agentStatusByPaneKey'
  | 'setSnoozeTabConfirm'
>

export type SnoozeTabDeps = {
  getState: () => SnoozeState
  /** Pushes the tab's on-screen output into its layout before it is read. */
  captureOutput: (tabId: string) => void
  collectAgentSessions: (
    worktreeId: string
  ) => ReturnType<typeof collectSleepingAgentSessionRecordsForWorktree>
  api: Pick<PreloadApi['tabSnooze'], 'add' | 'discard'> | undefined
  closeTab: (tabId: string) => void
  notify: (outcome: SnoozeTabOutcome) => void
}

function findTerminalTab(state: SnoozeState, tabId: string) {
  for (const tabs of Object.values(state.tabsByWorktree)) {
    const tab = tabs.find((candidate) => candidate.id === tabId)
    if (tab) {
      return tab
    }
  }
  return null
}

/**
 * Snoozes one terminal tab: main saves it first, then the tab closes. Order
 * matters twice over. The conversation is read while the terminal is still
 * alive, and a tab that went away while main was saving does not keep its
 * entry (it was closed for real, not snoozed).
 */
// Why one lock for the menu and `dobius tabs snooze`: two snoozes of one tab
// would both save it, and the second, finding the tab closed, would discard
// the entry (and conversation) the first just saved.
const snoozingTabs = new Set<string>()

export async function runTabSnooze(
  deps: SnoozeTabDeps,
  tabId: string,
  until: number | null,
  options: { confirmed?: boolean } = {}
): Promise<SnoozeTabOutcome> {
  if (snoozingTabs.has(tabId)) {
    return 'in-progress'
  }
  snoozingTabs.add(tabId)
  try {
    return await snoozeTabOnce(deps, tabId, until, options)
  } finally {
    snoozingTabs.delete(tabId)
  }
}

async function snoozeTabOnce(
  deps: SnoozeTabDeps,
  tabId: string,
  until: number | null,
  options: { confirmed?: boolean }
): Promise<SnoozeTabOutcome> {
  const done = (outcome: SnoozeTabOutcome): SnoozeTabOutcome => {
    deps.notify(outcome)
    return outcome
  }
  const before = findTerminalTab(deps.getState(), tabId)
  if (!before) {
    return 'missing'
  }
  if (!deps.api) {
    return done('unavailable')
  }
  deps.captureOutput(tabId)
  const state = deps.getState()
  const tab = findTerminalTab(state, tabId) ?? before
  const plan = planTabSnooze({
    tab,
    unifiedTab: (state.unifiedTabsByWorktree[tab.worktreeId] ?? []).find(
      (candidate) => candidate.contentType === 'terminal' && candidate.entityId === tabId
    ),
    layout: state.terminalLayoutsByTabId[tabId],
    agentSessions: deps.collectAgentSessions(tab.worktreeId),
    paneStatuses: Object.values(state.agentStatusByPaneKey),
    until
  })
  if (!plan.ok) {
    return done(plan.reason)
  }
  if (plan.working && !options.confirmed) {
    state.setSnoozeTabConfirm({ tabId, tabLabel: plan.label, until, resumes: plan.resumes })
    return 'needs-confirm'
  }
  const result = await deps.api.add(plan.request)
  if (!result.ok) {
    return done(result.reason)
  }
  if (!findTerminalTab(deps.getState(), tabId)) {
    await deps.api.discard({ worktreeId: tab.worktreeId, tabId })
    return 'tab-gone'
  }
  deps.closeTab(tabId)
  return done('snoozed')
}

function notifySnoozeOutcome(outcome: SnoozeTabOutcome): void {
  switch (outcome) {
    // Nothing to show: the confirm dialog, or the missing tab, says it all.
    case 'needs-confirm':
    case 'missing':
    case 'tab-gone':
    case 'in-progress':
      return
    case 'snoozed':
      toast.success(translate('lib.tabSnooze.snoozed', 'Tab snoozed. It waits in the sidebar.'))
      return
    case 'split-panes':
      toast.error(
        translate(
          'lib.tabSnooze.splitPanes',
          'Snooze works on tabs with one pane. Close the extra panes first.'
        )
      )
      return
    case 'conversation-not-resumable':
      toast.error(
        translate(
          'lib.tabSnooze.conversationNotResumable',
          'This conversation cannot be saved for later yet. Try again in a moment.'
        )
      )
      return
    case 'full':
      toast.error(
        translate(
          'lib.tabSnooze.full',
          'The Snoozed shelf is full. Bring a tab back or close one for good first.'
        )
      )
      return
    case 'invalid':
    case 'unavailable':
      toast.error(translate('lib.tabSnooze.failed', 'This tab could not be snoozed.'))
  }
}

/** The app's own snooze wiring; `dobius tabs snooze` reuses it (snooze-tab-cli-event.ts). */
export function snoozeTerminalTabDeps(): SnoozeTabDeps {
  return {
    getState: () => useAppStore.getState(),
    captureOutput: (id) => {
      try {
        shutdownBufferCaptures.get(id)?.({ includeLocalBuffers: true })
      } catch (err) {
        // Why not fatal: the tab still snoozes, with whatever output the session last saved.
        console.warn('[tab-snooze] output capture failed:', err)
      }
    },
    collectAgentSessions: (worktreeId) =>
      collectSleepingAgentSessionRecordsForWorktree(useAppStore.getState(), worktreeId, {
        captureMode: 'manual-worktree-sleep'
      }),
    api: window.api.tabSnooze,
    // Why force: a pinned tab keeps its pin in the entry and comes back pinned.
    closeTab: (id) => closeTerminalTab(id, { force: true }),
    notify: notifySnoozeOutcome
  }
}

export function snoozeTerminalTab(
  tabId: string,
  until: number | null,
  options: { confirmed?: boolean } = {}
): Promise<SnoozeTabOutcome> {
  return runTabSnooze(snoozeTerminalTabDeps(), tabId, until, options)
}
