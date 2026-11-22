import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { buildAgentResumeStartupPlan } from '@/lib/tui-agent-startup'
import {
  appendTabToWorktreeOrder,
  getResumeLaunchPlatform
} from '@/lib/resume-sleeping-agent-session'
import { activeOrQueuedResumeClaimsProviderSession } from '@/lib/sleeping-agent-pane-ownership'
import {
  resolveTuiAgentLaunchArgs,
  resolveTuiAgentLaunchEnv
} from '../../../../shared/tui-agent-launch-defaults'
import type { SleepingAgentSessionRecord } from '../../../../shared/agent-session-resume'
import type { SnoozedTabEntry, SnoozedTabRef } from '../../../../shared/tab-snooze-types'
import type { AgentStartupPlan } from '@/lib/tui-agent-startup'
import { runBringBackSnoozedTab } from './bring-back-snoozed-tab'
import type { BringBackOptions, BringBackOutcome } from './bring-back-snoozed-tab'

/** Same launch plan the worktree-wake path builds for a sleeping agent session. */
function buildResumePlan(record: SleepingAgentSessionRecord): AgentStartupPlan | null {
  const state = useAppStore.getState()
  const launchConfig = record.launchConfig
  return buildAgentResumeStartupPlan({
    agent: record.agent,
    providerSession: record.providerSession,
    cmdOverrides: state.settings?.agentCmdOverrides ?? {},
    agentArgs:
      launchConfig !== undefined
        ? launchConfig.agentArgs
        : resolveTuiAgentLaunchArgs(record.agent, state.settings?.agentDefaultArgs),
    agentEnv:
      launchConfig !== undefined
        ? launchConfig.agentEnv
        : resolveTuiAgentLaunchEnv(record.agent, state.settings?.agentDefaultEnv),
    ...(launchConfig?.agentCommand ? { agentCommand: launchConfig.agentCommand } : {}),
    platform: getResumeLaunchPlatform(record.worktreeId)
  })
}

function notifyBringBack(outcome: BringBackOutcome, entry: SnoozedTabEntry | null): void {
  const title = entry?.customTitle ?? entry?.title ?? ''
  if (outcome === 'returned' && entry?.ready) {
    toast(translate('lib.tabSnooze.back', 'A snoozed tab is back'), { description: title })
    return
  }
  if (outcome === 'already-open') {
    toast(
      translate('lib.tabSnooze.alreadyOpen', 'That conversation is already open in another tab.'),
      { description: title }
    )
    return
  }
  if (outcome === 'put-back') {
    toast.error(
      translate(
        'lib.tabSnooze.putBack',
        'This tab could not pick its conversation back up, so it is still in Snoozed.'
      ),
      { description: title }
    )
  }
}

/** Reopens a snoozed tab now, or queues it until this window's tabs are restored. */
export function bringBackSnoozedTab(
  ref: SnoozedTabRef,
  options: BringBackOptions = {}
): Promise<BringBackOutcome> {
  return runBringBackSnoozedTab(
    {
      getState: () => useAppStore.getState(),
      api: window.api.tabSnooze,
      isKnownWorktree: (worktreeId) =>
        Boolean(useAppStore.getState().getKnownWorktreeById(worktreeId)),
      claimAgentResume: (owner) => window.api.pty.claimAgentResume(owner),
      releaseAgentResume: (token, owner) => window.api.pty.releaseAgentResume(token, owner),
      buildResumePlan,
      conversationIsOpen: (record) =>
        activeOrQueuedResumeClaimsProviderSession(record, useAppStore.getState()),
      appendTabToOrder: appendTabToWorktreeOrder,
      newId: createBrowserUuid,
      notify: notifyBringBack
    },
    ref,
    options
  )
}

/** A new time for a snoozed row (null: until brought back). */
export async function resnoozeSnoozedTab(ref: SnoozedTabRef, until: number | null): Promise<void> {
  await window.api.tabSnooze?.setTime(ref, until)
}

/** Drops a snoozed tab and its saved output. The conversation itself stays in History. */
export async function closeSnoozedTabForGood(ref: SnoozedTabRef): Promise<void> {
  await window.api.tabSnooze?.discard(ref)
}

/** Folds or unfolds a worktree's Snoozed shelf and remembers it. */
export function toggleSnoozedShelf(worktreeId: string): void {
  const state = useAppStore.getState()
  state.toggleSnoozedShelf(worktreeId)
  window.api.ui
    .set({ snoozedShelfOpenWorktreeIds: useAppStore.getState().snoozedShelfOpenWorktreeIds })
    .catch(console.error)
}
