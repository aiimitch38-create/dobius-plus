import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { CLIENT_PLATFORM } from '@/lib/new-workspace'
import { buildAgentResumeStartupPlan } from '@/lib/tui-agent-startup'
import { tuiAgentToAgentKind } from '@/lib/telemetry'
import { reconcileTabOrder } from '@/components/tab-bar/reconcile-order'
import { isWslUncPath } from '../../../shared/wsl-paths'
import { getLocalProjectExecutionRuntimeContext } from '@/lib/local-preflight-context'
import {
  resolveTuiAgentLaunchArgs,
  resolveTuiAgentLaunchEnv
} from '../../../shared/tui-agent-launch-defaults'
import type { SleepingAgentSessionRecord } from '../../../shared/agent-session-resume'
import {
  AGENT_RESUME_CLAIM_ENV,
  encodeAgentResumeSpawnClaim,
  getAgentResumeOwnerFingerprint
} from '../../../shared/agent-resume-owner'
import { translate } from '@/i18n/i18n'
import {
  activeOrQueuedResumeClaimsProviderSession,
  clearPassiveCompletedRecordsForClaimKey,
  getCurrentPaneOwnedClaimKeys,
  getNewestActiveRecordsByClaimKey,
  getProviderSessionClaimKey,
  hasQueuedAutomaticAgentResumeClaim,
  isInvalidWorktreeActivationRecord,
  isPassiveCompletedHibernationEvidence,
  recordPaneIsOwnedByPreservedPane
} from './sleeping-agent-pane-ownership'
export { getWorktreeIdsNeedingStartupResume } from './sleeping-agent-pane-ownership'

function getResumeLaunchPlatform(worktreeId: string): NodeJS.Platform {
  const state = useAppStore.getState()
  const worktree = state.getKnownWorktreeById(worktreeId)
  const repo = worktree ? state.repos.find((entry) => entry.id === worktree.repoId) : null
  const projectRuntime = getLocalProjectExecutionRuntimeContext(state, worktreeId)
  if (projectRuntime?.status === 'repair-required') {
    return projectRuntime.repair.preferredRuntime.kind === 'wsl' ? 'linux' : CLIENT_PLATFORM
  }
  if (projectRuntime?.status === 'resolved' && projectRuntime.runtime.kind === 'wsl') {
    return 'linux'
  }
  if (repo?.connectionId || (worktree?.path && isWslUncPath(worktree.path))) {
    return 'linux'
  }
  return CLIENT_PLATFORM
}

function appendTabToWorktreeOrder(worktreeId: string, tabId: string): void {
  const state = useAppStore.getState()
  const termIds = (state.tabsByWorktree[worktreeId] ?? []).map((tab) => tab.id)
  const editorIds = state.openFiles
    .filter((file) => file.worktreeId === worktreeId)
    .map((f) => f.id)
  const browserIds = (state.browserTabsByWorktree?.[worktreeId] ?? []).map((tab) => tab.id)
  const base = reconcileTabOrder(
    state.tabBarOrderByWorktree[worktreeId],
    termIds,
    editorIds,
    browserIds
  )
  const order = base.filter((id) => id !== tabId)
  order.push(tabId)
  state.setTabBarOrder(worktreeId, order)
}

async function launchSleepingAgentSession(record: SleepingAgentSessionRecord): Promise<boolean> {
  const resumeOwner = record.resumeOwner
  if (
    !resumeOwner ||
    getAgentResumeOwnerFingerprint(resumeOwner) !==
      getAgentResumeOwnerFingerprint({
        ...resumeOwner,
        paneKey: record.paneKey,
        worktreeId: record.worktreeId,
        agent: record.agent,
        providerSession: record.providerSession
      })
  ) {
    return false
  }
  const claim = await window.api.pty.claimAgentResume(resumeOwner).catch(() => null)
  if (
    !claim?.ok ||
    useAppStore.getState().sleepingAgentSessionsByPaneKey[record.paneKey] !== record
  ) {
    return false
  }
  const state = useAppStore.getState()
  const launchConfig = record.launchConfig
  const startupPlan = buildAgentResumeStartupPlan({
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
  if (!startupPlan) {
    void window.api.pty.releaseAgentResume(claim.token, resumeOwner)
    toast.error(
      translate(
        'auto.lib.resume.sleeping.agent.session.f235f604fd',
        'This agent session cannot be resumed.'
      )
    )
    return false
  }

  try {
    const tab = state.createTab(record.worktreeId, undefined, undefined, {
      launchAgent: record.agent,
      activate: false
    })
    state.queueTabStartupCommand(tab.id, {
      command: startupPlan.launchCommand,
      env: {
        ...startupPlan.env,
        [AGENT_RESUME_CLAIM_ENV]: encodeAgentResumeSpawnClaim({
          token: claim.token,
          owner: resumeOwner,
          target: claim.target
        })
      },
      launchConfig: startupPlan.launchConfig,
      resumeProviderSession: record.providerSession,
      launchAgent: record.agent,
      ...(startupPlan.startupCommandDelivery
        ? { startupCommandDelivery: startupPlan.startupCommandDelivery }
        : {}),
      showSessionRestoredBanner: true,
      telemetry: {
        agent_kind: tuiAgentToAgentKind(record.agent),
        launch_source: 'sidebar',
        request_kind: 'resume'
      }
    })
    state.claimAutomaticAgentResume(tab.id, {
      worktreeId: record.worktreeId,
      launchAgent: record.agent,
      providerSession: record.providerSession
    })
    appendTabToWorktreeOrder(record.worktreeId, tab.id)
    return true
  } catch {
    void window.api.pty.releaseAgentResume(claim.token, resumeOwner)
    return false
  }
}

export async function resumeSleepingAgentSessionsForWorktree(worktreeId: string): Promise<number> {
  const state = useAppStore.getState()
  const worktreeRecords = Object.values(state.sleepingAgentSessionsByPaneKey)
    .filter((record) => record.worktreeId === worktreeId)
    .sort((a, b) => a.capturedAt - b.capturedAt || a.updatedAt - b.updatedAt)
  const validWorktreeRecords = worktreeRecords.filter(
    (record) => !isInvalidWorktreeActivationRecord(record)
  )
  const activeWorktreeRecords = validWorktreeRecords.filter(
    (record) => !isPassiveCompletedHibernationEvidence(record)
  )
  const activeClaimKeys = new Set(activeWorktreeRecords.map(getProviderSessionClaimKey))
  const newestActiveRecordByClaimKey = getNewestActiveRecordsByClaimKey(activeWorktreeRecords)
  const freshlyLaunchedClaimKeys = new Set<string>()

  let launched = 0
  for (const record of worktreeRecords) {
    const currentState = useAppStore.getState()
    if (currentState.sleepingAgentSessionsByPaneKey[record.paneKey] !== record) {
      continue
    }
    const claimKey = getProviderSessionClaimKey(record)
    if (isInvalidWorktreeActivationRecord(record)) {
      state.clearSleepingAgentSession(record.paneKey)
      continue
    }
    const isPaneOwned = recordPaneIsOwnedByPreservedPane(record, currentState)
    if (isPassiveCompletedHibernationEvidence(record)) {
      // Why: completed-agent hibernation is passive history; activation should
      // only keep displayable evidence, never start new work from it.
      if (!isPaneOwned || activeClaimKeys.has(claimKey)) {
        state.clearSleepingAgentSession(record.paneKey)
      }
      continue
    }
    if (activeOrQueuedResumeClaimsProviderSession(record, currentState)) {
      // Why: queued startup suppresses duplicates, while its source evidence
      // stays durable until the PTY spawn acknowledges success.
      if (!hasQueuedAutomaticAgentResumeClaim(record, currentState)) {
        state.clearSleepingAgentSession(record.paneKey)
      }
      continue
    }
    const paneOwnedClaimKeys = getCurrentPaneOwnedClaimKeys(activeWorktreeRecords)
    if (paneOwnedClaimKeys.has(claimKey)) {
      if (!isPaneOwned) {
        state.clearSleepingAgentSession(record.paneKey)
      }
      continue
    }
    if (freshlyLaunchedClaimKeys.has(claimKey)) {
      // Keep aliases until the queued owner successfully spawns; provider
      // failure must leave at least one recoverable captured session.
      continue
    }
    if (newestActiveRecordByClaimKey.get(claimKey) !== record) {
      // A newer duplicate may fail before spawning; keep the older evidence
      // until one owner successfully starts and can clear all aliases.
      continue
    }
    if (isPaneOwned) {
      continue
    }
    if (await launchSleepingAgentSession(record)) {
      launched += 1
      freshlyLaunchedClaimKeys.add(claimKey)
      clearPassiveCompletedRecordsForClaimKey(worktreeRecords, claimKey, record.paneKey)
    }
  }
  return launched
}
