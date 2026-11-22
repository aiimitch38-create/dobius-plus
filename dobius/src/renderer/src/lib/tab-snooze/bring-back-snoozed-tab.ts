import type {
  AgentResumeOwner,
  AgentResumeSpawnTarget
} from '../../../../shared/agent-resume-owner'
import {
  AGENT_RESUME_CLAIM_ENV,
  encodeAgentResumeSpawnClaim
} from '../../../../shared/agent-resume-owner'
import type { SleepingAgentSessionRecord } from '../../../../shared/agent-session-resume'
import type { SnoozedTabEntry, SnoozedTabRef } from '../../../../shared/tab-snooze-types'
import type { TuiAgent } from '../../../../shared/types'
import type { PreloadApi } from '../../../../preload/api-types'
import type { AgentStartupPlan } from '@/lib/tui-agent-startup'
import type { AppState } from '@/store/types'

export type BringBackOutcome =
  | 'returned'
  | 'queued'
  | 'not-available'
  | 'unknown-worktree'
  | 'already-open'
  | 'put-back'

type BringBackState = Pick<
  AppState,
  | 'workspaceSessionReady'
  | 'activeWorktreeId'
  | 'tabsByWorktree'
  | 'ptyIdsByTabId'
  | 'terminalLayoutsByTabId'
  | 'unifiedTabsByWorktree'
  | 'createTab'
  | 'setActiveTab'
  | 'setActiveTabType'
  | 'setTabCustomTitle'
  | 'setTabColor'
  | 'setTabLayout'
  | 'queueTabStartupCommand'
  | 'claimAutomaticAgentResume'
  | 'pinTab'
  | 'markTerminalTabUnread'
  | 'queueSnoozeBringBack'
  | 'trackReturningSnoozedTab'
>

export type BringBackDeps = {
  getState: () => BringBackState
  api: Pick<PreloadApi['tabSnooze'], 'take' | 'settle' | 'putBack'>
  isKnownWorktree: (worktreeId: string) => boolean
  /** The existing session-claim gate (pty:claimAgentResume). */
  claimAgentResume: (
    owner: AgentResumeOwner
  ) => Promise<{ ok: true; token: string; target: AgentResumeSpawnTarget } | null>
  releaseAgentResume: (token: string, owner: AgentResumeOwner) => Promise<boolean>
  buildResumePlan: (record: SleepingAgentSessionRecord) => AgentStartupPlan | null
  /** True when this conversation is already running (or queued) in a tab here. */
  conversationIsOpen: (record: SleepingAgentSessionRecord) => boolean
  appendTabToOrder: (worktreeId: string, tabId: string) => void
  newId: () => string
  notify: (outcome: BringBackOutcome, entry: SnoozedTabEntry | null) => void
}

export type BringBackOptions = {
  /** A timed return: only an entry that is still ready, and it arrives unread. */
  onlyReady?: boolean
}

function tabHasStarted(state: BringBackState, worktreeId: string, tabId: string): boolean {
  const tab = (state.tabsByWorktree[worktreeId] ?? []).find((candidate) => candidate.id === tabId)
  return Boolean(tab && (tab.ptyId || (state.ptyIdsByTabId[tabId]?.length ?? 0) > 0))
}

/**
 * Reopens a snoozed tab. A tab that had an agent conversation resumes it
 * through the session-claim gate or does not come back at all: when the claim
 * is refused the entry goes back on the shelf. It never returns as a plain
 * shell, which would look like the conversation was lost.
 */
export async function runBringBackSnoozedTab(
  deps: BringBackDeps,
  ref: SnoozedTabRef,
  options: BringBackOptions = {}
): Promise<BringBackOutcome> {
  const initial = deps.getState()
  if (!initial.workspaceSessionReady) {
    // Why queue: this window's tabs are not restored yet. Taking the entry now
    // would add a tab that the restore then wipes, and the entry would be lost.
    if (!options.onlyReady) {
      initial.queueSnoozeBringBack(ref)
      return 'queued'
    }
    return 'not-available'
  }
  if (!deps.isKnownWorktree(ref.worktreeId)) {
    return 'unknown-worktree'
  }
  const taken = await deps.api.take(ref, {
    onlyReady: options.onlyReady === true,
    returnTabId: deps.newId()
  })
  if (!taken) {
    return 'not-available'
  }
  const { entry } = taken
  const tabId = entry.returnTabId ?? deps.newId()
  const done = (outcome: BringBackOutcome): BringBackOutcome => {
    deps.notify(outcome, entry)
    return outcome
  }
  const putBack = async (): Promise<BringBackOutcome> => {
    await deps.api.putBack(ref)
    return done('put-back')
  }

  if (tabHasStarted(deps.getState(), ref.worktreeId, tabId)) {
    // An earlier attempt already made this tab and its terminal is running.
    await deps.api.settle(ref)
    return 'returned'
  }

  const record = entry.agentSession
  let claim: { token: string; owner: AgentResumeOwner; target: AgentResumeSpawnTarget } | null =
    null
  let plan: AgentStartupPlan | null = null
  if (record) {
    if (deps.conversationIsOpen(record)) {
      await deps.api.settle(ref)
      return done('already-open')
    }
    const owner = record.resumeOwner
    if (!owner) {
      return putBack()
    }
    const claimed = await deps.claimAgentResume(owner).catch(() => null)
    if (!claimed?.ok) {
      return putBack()
    }
    claim = { token: claimed.token, owner, target: claimed.target }
    plan = deps.buildResumePlan(record)
    if (!plan) {
      void deps.releaseAgentResume(claim.token, owner)
      return putBack()
    }
  }

  try {
    const state = deps.getState()
    const activate = !options.onlyReady && state.activeWorktreeId === ref.worktreeId
    const existing = (state.tabsByWorktree[ref.worktreeId] ?? []).find(
      (candidate) => candidate.id === tabId
    )
    const tab =
      existing ??
      state.createTab(ref.worktreeId, undefined, entry.shellOverride, {
        id: tabId,
        activate,
        ...((record?.agent ?? entry.launchAgent)
          ? { launchAgent: (record?.agent ?? entry.launchAgent) as TuiAgent }
          : {}),
        ...(entry.viewMode ? { viewMode: entry.viewMode } : {}),
        ...(entry.startupCwd ? { startupCwd: entry.startupCwd } : {})
      })
    if (activate) {
      if (existing) {
        state.setActiveTab(tab.id)
      }
      // Why: the user may be looking at an editor or browser tab; the tab they
      // asked for has to be the one in front.
      state.setActiveTabType('terminal')
    }
    if (entry.customTitle) {
      state.setTabCustomTitle(tab.id, entry.customTitle, { recordInteraction: false })
    }
    if (entry.color) {
      state.setTabColor(tab.id, entry.color)
    }
    if (taken.scrollback) {
      const layout = state.terminalLayoutsByTabId[tab.id]
      const leafId = layout?.root?.type === 'leaf' ? layout.root.leafId : deps.newId()
      // Why a layout: a mounting terminal replays buffersByLeafId above its
      // first prompt, which is how the old output comes back.
      state.setTabLayout(tab.id, {
        root: { type: 'leaf', leafId },
        activeLeafId: leafId,
        expandedLeafId: null,
        buffersByLeafId: { [leafId]: taken.scrollback }
      })
    }
    if (record && plan && claim) {
      state.queueTabStartupCommand(tab.id, {
        command: plan.launchCommand,
        env: {
          ...plan.env,
          [AGENT_RESUME_CLAIM_ENV]: encodeAgentResumeSpawnClaim(claim)
        },
        launchConfig: plan.launchConfig,
        resumeProviderSession: record.providerSession,
        launchAgent: record.agent,
        ...(plan.startupCommandDelivery
          ? { startupCommandDelivery: plan.startupCommandDelivery }
          : {}),
        showSessionRestoredBanner: true
      })
      state.claimAutomaticAgentResume(tab.id, {
        worktreeId: ref.worktreeId,
        launchAgent: record.agent,
        providerSession: record.providerSession
      })
    }
    if (entry.pinned) {
      const unified = (deps.getState().unifiedTabsByWorktree[ref.worktreeId] ?? []).find(
        (candidate) => candidate.contentType === 'terminal' && candidate.entityId === tab.id
      )
      if (unified && !unified.isPinned) {
        state.pinTab(unified.id)
      }
    }
    deps.appendTabToOrder(ref.worktreeId, tab.id)
    if (!activate) {
      state.markTerminalTabUnread(tab.id)
    }
    state.trackReturningSnoozedTab(tab.id, {
      ref,
      ...(claim ? { claim: { token: claim.token, owner: claim.owner } } : {})
    })
    return done('returned')
  } catch (err) {
    console.warn('[tab-snooze] reopening the tab failed:', err)
    if (claim) {
      void deps.releaseAgentResume(claim.token, claim.owner)
    }
    return putBack()
  }
}
