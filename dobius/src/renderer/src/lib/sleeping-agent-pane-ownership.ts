import { useAppStore } from '@/store'
import type {
  AgentProviderSessionMetadata,
  SleepingAgentSessionRecord
} from '../../../shared/agent-session-resume'
import { AGENT_STATUS_STALE_AFTER_MS } from '../../../shared/agent-status-types'
import type {
  TerminalLayoutSnapshot,
  TerminalPaneLayoutNode,
  TerminalTab
} from '../../../shared/types'
import { parseLegacyNumericPaneKey, parsePaneKey } from '../../../shared/stable-pane-id'

type AppStoreState = ReturnType<typeof useAppStore.getState>

export function getProviderSessionClaimKey(record: SleepingAgentSessionRecord): string {
  return `${record.worktreeId}\0${record.agent}\0${record.providerSession.key}\0${record.providerSession.id}`
}

/** Return worktrees whose persisted panes need a one-time startup ownership pass. */
export function getWorktreeIdsNeedingStartupResume(
  sleepingAgentSessionsByPaneKey: Readonly<Record<string, SleepingAgentSessionRecord>>,
  activeWorktreeId: string,
  alreadySwept: ReadonlySet<string>
): string[] {
  const candidates = new Set<string>([
    activeWorktreeId,
    ...Object.values(sleepingAgentSessionsByPaneKey).map((record) => record.worktreeId)
  ])
  return [...candidates].filter((worktreeId) => !alreadySwept.has(worktreeId))
}

export function clearPassiveCompletedRecordsForClaimKey(
  records: readonly SleepingAgentSessionRecord[],
  claimKey: string,
  keepPaneKey: string
): void {
  const state = useAppStore.getState()
  for (const record of records) {
    if (
      record.paneKey !== keepPaneKey &&
      isPassiveCompletedHibernationEvidence(record) &&
      getProviderSessionClaimKey(record) === claimKey
    ) {
      state.clearSleepingAgentSession(record.paneKey)
    }
  }
}

export function getCurrentPaneOwnedClaimKeys(
  records: readonly SleepingAgentSessionRecord[]
): Set<string> {
  const state = useAppStore.getState()
  const keys = new Set<string>()
  for (const record of records) {
    if (
      state.sleepingAgentSessionsByPaneKey[record.paneKey] === record &&
      !isInvalidWorktreeActivationRecord(record) &&
      !isPassiveCompletedHibernationEvidence(record) &&
      recordPaneIsOwnedByPreservedPane(record, state)
    ) {
      keys.add(getProviderSessionClaimKey(record))
    }
  }
  return keys
}

export function getNewestActiveRecordsByClaimKey(
  records: readonly SleepingAgentSessionRecord[]
): Map<string, SleepingAgentSessionRecord> {
  const newestRecords = new Map<string, SleepingAgentSessionRecord>()
  for (const record of records) {
    const claimKey = getProviderSessionClaimKey(record)
    const current = newestRecords.get(claimKey)
    if (
      !current ||
      record.capturedAt > current.capturedAt ||
      (record.capturedAt === current.capturedAt && record.updatedAt > current.updatedAt)
    ) {
      newestRecords.set(claimKey, record)
    }
  }
  return newestRecords
}

function providerSessionsMatch(
  left: AgentProviderSessionMetadata | undefined,
  right: AgentProviderSessionMetadata
): boolean {
  return Boolean(left && left.key === right.key && left.id === right.id)
}

function getAgentStatusTabId(entry: { paneKey: string; tabId?: string }): string | null {
  if (entry.tabId) {
    return entry.tabId
  }
  const separatorIndex = entry.paneKey.indexOf(':')
  return separatorIndex === -1 ? null : entry.paneKey.slice(0, separatorIndex)
}

export function activeOrQueuedResumeClaimsProviderSession(
  record: SleepingAgentSessionRecord,
  state: AppStoreState
): boolean {
  const worktreeTabIds = new Set(
    (state.tabsByWorktree[record.worktreeId] ?? []).map((tab) => tab.id)
  )
  for (const entry of Object.values(state.agentStatusByPaneKey)) {
    if (
      worktreeTabIds.has(getAgentStatusTabId(entry) ?? '') &&
      entry.worktreeId === record.worktreeId &&
      entry.agentType === record.agent &&
      entry.state !== 'done' &&
      providerSessionsMatch(entry.providerSession, record.providerSession)
    ) {
      return true
    }
  }

  for (const [tabId, startup] of Object.entries(state.pendingStartupByTabId)) {
    if (
      worktreeTabIds.has(tabId) &&
      startup.launchAgent === record.agent &&
      providerSessionsMatch(startup.resumeProviderSession, record.providerSession)
    ) {
      return true
    }
  }

  for (const [tabId, claim] of Object.entries(state.automaticAgentResumeClaimsByTabId)) {
    if (
      worktreeTabIds.has(tabId) &&
      claim.worktreeId === record.worktreeId &&
      claim.launchAgent === record.agent &&
      providerSessionsMatch(claim.providerSession, record.providerSession)
    ) {
      return true
    }
  }
  return false
}

/** Queued startup owns duplicate suppression, but source evidence must survive failed spawn. */
export function hasQueuedAutomaticAgentResumeClaim(
  record: SleepingAgentSessionRecord,
  state: AppStoreState
): boolean {
  const worktreeTabIds = new Set(
    (state.tabsByWorktree[record.worktreeId] ?? []).map((tab) => tab.id)
  )
  return Object.entries(state.automaticAgentResumeClaimsByTabId).some(
    ([tabId, claim]) =>
      worktreeTabIds.has(tabId) &&
      claim.worktreeId === record.worktreeId &&
      claim.launchAgent === record.agent &&
      claim.providerSession.key === record.providerSession.key &&
      claim.providerSession.id === record.providerSession.id
  )
}

export function isInvalidWorktreeActivationRecord(record: SleepingAgentSessionRecord): boolean {
  if (record.interrupted === true || (!record.origin && record.state === 'done')) {
    return true
  }
  return (
    record.state !== 'done' && record.capturedAt - record.updatedAt > AGENT_STATUS_STALE_AFTER_MS
  )
}

export function isPassiveCompletedHibernationEvidence(record: SleepingAgentSessionRecord): boolean {
  return record.origin !== 'quit' && record.origin !== 'live' && record.state === 'done'
}

function getLegacyPaneTabId(record: SleepingAgentSessionRecord): string | null {
  const legacy = parseLegacyNumericPaneKey(record.paneKey)
  if (!legacy || (record.tabId && record.tabId !== legacy.tabId)) {
    return null
  }
  return record.tabId ?? legacy.tabId
}

function getLegacyProviderSessionKeysForTab(
  state: AppStoreState,
  worktreeId: string,
  tabId: string
): Set<string> {
  const keys = new Set<string>()
  for (const record of Object.values(state.sleepingAgentSessionsByPaneKey)) {
    if (record.worktreeId === worktreeId && getLegacyPaneTabId(record) === tabId) {
      keys.add(getProviderSessionClaimKey(record))
    }
  }
  return keys
}

function layoutContainsLeaf(
  node: TerminalPaneLayoutNode | null | undefined,
  leafId: string
): boolean {
  return Boolean(
    node &&
    (node.type === 'leaf'
      ? node.leafId === leafId
      : layoutContainsLeaf(node.first, leafId) || layoutContainsLeaf(node.second, leafId))
  )
}

function hasMatchingStablePaneLayout(
  tabId: string,
  leafId: string,
  terminalLayoutsByTabId: Record<string, TerminalLayoutSnapshot | undefined>
): boolean {
  // Why: hibernation intentionally clears the live PTY binding after the pane
  // exits, but the preserved leaf still owns cold-restore for its session.
  return layoutContainsLeaf(terminalLayoutsByTabId[tabId]?.root, leafId)
}

function hasRestorableStablePanePty(
  tab: TerminalTab,
  tabId: string,
  leafId: string,
  ptyIdsByTabId: Record<string, string[] | undefined>,
  terminalLayoutsByTabId: Record<string, TerminalLayoutSnapshot | undefined>
): boolean {
  const layout = terminalLayoutsByTabId[tabId]
  const hasLeafPty = Boolean(layout?.ptyIdsByLeafId?.[leafId])
  const isSingleLeafLayout = layout?.root?.type === 'leaf' && layout.root.leafId === leafId

  return Boolean(
    hasLeafPty || (isSingleLeafLayout && (tab.ptyId || (ptyIdsByTabId[tabId]?.length ?? 0) > 0))
  )
}

function paneWillConnectOnActivation(
  worktreeId: string,
  tabId: string,
  state: AppStoreState
): boolean {
  if (state.activeWorktreeId !== worktreeId) {
    return false
  }
  if (state.activeTabType === 'terminal' && state.activeTabId === tabId) {
    return true
  }
  // Why: split groups can show multiple terminal tabs at once; each group's
  // active terminal mounts and connects even when another group has focus.
  const groups = state.groupsByWorktree[worktreeId] ?? []
  const unifiedTabs = state.unifiedTabsByWorktree[worktreeId] ?? []
  return groups.some((group) => {
    const tab = group.activeTabId
      ? unifiedTabs.find((candidate) => candidate.id === group.activeTabId)
      : null
    return tab?.contentType === 'terminal' && tab.entityId === tabId
  })
}

export function recordPaneIsOwnedByPreservedPane(
  record: SleepingAgentSessionRecord,
  state: AppStoreState
): boolean {
  const worktreeTabs = state.tabsByWorktree[record.worktreeId] ?? []
  const stable = parsePaneKey(record.paneKey)
  if (stable) {
    if (record.tabId && record.tabId !== stable.tabId) {
      return false
    }
    const tabId = record.tabId ?? stable.tabId
    const tab = worktreeTabs.find((candidate) => candidate.id === tabId) ?? null
    if (!tab || !hasMatchingStablePaneLayout(tabId, stable.leafId, state.terminalLayoutsByTabId)) {
      return false
    }
    if (isPassiveCompletedHibernationEvidence(record)) {
      return true
    }
    // Why: active sessions rely on pane-level cold restore. A preserved leaf
    // without a PTY/session id can repaint scrollback but cannot resume.
    return (
      hasRestorableStablePanePty(
        tab,
        tabId,
        stable.leafId,
        state.ptyIdsByTabId,
        state.terminalLayoutsByTabId
      ) && paneWillConnectOnActivation(record.worktreeId, tabId, state)
    )
  }

  const tabId = getLegacyPaneTabId(record)
  if (!tabId) {
    return false
  }
  const tab = worktreeTabs.find((candidate) => candidate.id === tabId) ?? null
  const providerKeys = getLegacyProviderSessionKeysForTab(state, record.worktreeId, tabId)
  // Why: legacy numeric pane keys lack leaf identity, so only a preserved
  // tab-level wake hint plus a single provider session is strong enough to
  // claim pane recovery without risking the wrong split-pane session.
  return Boolean(
    tab &&
    (tab.ptyId || (state.ptyIdsByTabId[tab.id]?.length ?? 0) > 0) &&
    providerKeys.size === 1 &&
    paneWillConnectOnActivation(record.worktreeId, tabId, state)
  )
}
