import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SleepingAgentSessionRecord } from '../../../shared/agent-session-resume'
import type { AgentResumeOwner } from '../../../shared/agent-resume-owner'
import { getAgentResumeSpawnTarget } from '../../../shared/agent-resume-owner'
import { makePaneKey } from '../../../shared/stable-pane-id'
import { useAppStore } from '@/store'
import {
  getWorktreeIdsNeedingStartupResume,
  resumeSleepingAgentSessionsForWorktree
} from './resume-sleeping-agent-session'
import { launchAiVaultSessionInNewTab } from './launch-ai-vault-session'
import { buildWorkspaceSessionPayload } from './workspace-session'

const initialAppStoreState = useAppStore.getState()
const LEAF_ID = '11111111-1111-4111-8111-111111111111'
const claimAgentResume = vi.fn(async (owner: AgentResumeOwner) => ({
  ok: true as const,
  token: 'claim-token',
  target: getAgentResumeSpawnTarget(owner)
}))

beforeEach(() => {
  vi.stubGlobal('window', {
    api: { pty: { claimAgentResume, releaseAgentResume: vi.fn(async () => true) } }
  })
  claimAgentResume.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  useAppStore.setState(initialAppStoreState, true)
})

function makeRecord(
  overrides: Partial<SleepingAgentSessionRecord> = {}
): SleepingAgentSessionRecord {
  const record: SleepingAgentSessionRecord = {
    paneKey: makePaneKey('old-tab', LEAF_ID),
    tabId: 'old-tab',
    worktreeId: 'wt-1',
    agent: 'codex',
    providerSession: { key: 'session_id', id: 'sess-1' },
    prompt: 'continue',
    state: 'working',
    capturedAt: 1,
    updatedAt: 1,
    origin: 'live',
    ...overrides
  }
  const parsed = record.paneKey === makePaneKey('old-tab', LEAF_ID) ? { leafId: LEAF_ID } : null
  if (!('resumeOwner' in overrides) && parsed) {
    record.resumeOwner = {
      authority: { kind: 'local' },
      worktreeId: record.worktreeId,
      tabId: record.tabId ?? 'old-tab',
      leafId: parsed.leafId,
      paneKey: record.paneKey,
      ptyId: 'pty-1',
      launchToken: 'launch-1',
      agent: record.agent as AgentResumeOwner['agent'],
      providerSession: record.providerSession
    }
  }
  return record
}

function makeTerminalTab(id: string): Record<string, unknown> {
  return { id, ptyId: null, worktreeId: 'wt-1', title: 'shell', sortOrder: 0, createdAt: 1 }
}

describe('resumeSleepingAgentSessionsForWorktree replay protection', async () => {
  it.each([
    ['quit-captured', 'quit'],
    ['live-checkpoint', 'live'],
    ['legacy sleep', undefined]
  ] as const)(
    'resumes %s records when no preserved pane can own recovery',
    async (_label, origin) => {
      const record = makeRecord(origin ? { origin } : {})
      useAppStore.setState({
        tabsByWorktree: { 'wt-1': [makeTerminalTab('tab-1')] },
        sleepingAgentSessionsByPaneKey: { [record.paneKey]: record }
      } as never)

      expect(await resumeSleepingAgentSessionsForWorktree('wt-1')).toBe(1)
      const state = useAppStore.getState()
      const resumedTab = state.tabsByWorktree['wt-1']?.find((tab) => tab.id !== 'tab-1')
      expect(resumedTab?.launchAgent).toBe('codex')
      expect(state.pendingStartupByTabId[resumedTab!.id]?.showSessionRestoredBanner).toBe(true)
      expect(state.sleepingAgentSessionsByPaneKey[record.paneKey]).toBe(record)
    }
  )

  it('stores provider-session metadata in the queued startup and runtime claim', async () => {
    const record = makeRecord()
    useAppStore.setState({
      tabsByWorktree: { 'wt-1': [] },
      sleepingAgentSessionsByPaneKey: { [record.paneKey]: record }
    } as never)

    expect(await resumeSleepingAgentSessionsForWorktree('wt-1')).toBe(1)
    const resumedTab = useAppStore.getState().tabsByWorktree['wt-1']![0]!
    const state = useAppStore.getState()
    expect(state.pendingStartupByTabId[resumedTab.id]?.resumeProviderSession).toEqual(
      record.providerSession
    )
    expect(state.automaticAgentResumeClaimsByTabId[resumedTab.id]).toEqual({
      worktreeId: record.worktreeId,
      launchAgent: record.agent,
      providerSession: record.providerSession
    })
  })

  it('does not fork a provider session that is already queued', async () => {
    const record = makeRecord()
    useAppStore.setState({
      tabsByWorktree: { 'wt-1': [] },
      sleepingAgentSessionsByPaneKey: { [record.paneKey]: record }
    } as never)

    expect(await resumeSleepingAgentSessionsForWorktree('wt-1')).toBe(1)
    useAppStore.setState((state) => ({
      sleepingAgentSessionsByPaneKey: {
        ...state.sleepingAgentSessionsByPaneKey,
        [record.paneKey]: record
      }
    }))

    expect(await resumeSleepingAgentSessionsForWorktree('wt-1')).toBe(0)
    expect(useAppStore.getState().tabsByWorktree['wt-1']).toHaveLength(1)
    expect(useAppStore.getState().sleepingAgentSessionsByPaneKey[record.paneKey]).toBe(record)
  })

  it('retries an unacknowledged queued startup without leaving a blank orphan', async () => {
    const record = makeRecord()
    useAppStore.setState({
      tabsByWorktree: { 'wt-1': [] },
      sleepingAgentSessionsByPaneKey: { [record.paneKey]: record }
    } as never)

    expect(await resumeSleepingAgentSessionsForWorktree('wt-1')).toBe(1)
    const resumedTab = useAppStore.getState().tabsByWorktree['wt-1']![0]!
    // The startup was consumed, then its provider spawn failed before a PTY
    // acknowledgment could clear the captured source record.
    expect(useAppStore.getState().consumeTabStartupCommand(resumedTab.id)).not.toBeNull()
    expect(useAppStore.getState().pendingStartupByTabId[resumedTab.id]).toBeUndefined()
    expect(await resumeSleepingAgentSessionsForWorktree('wt-1')).toBe(0)
    expect(useAppStore.getState().tabsByWorktree['wt-1']).toHaveLength(1)
    expect(useAppStore.getState().sleepingAgentSessionsByPaneKey[record.paneKey]).toBe(record)

    useAppStore.getState().closeTab(resumedTab.id)
    expect(await resumeSleepingAgentSessionsForWorktree('wt-1')).toBe(1)
    expect(useAppStore.getState().tabsByWorktree['wt-1']).toHaveLength(1)
    expect(useAppStore.getState().sleepingAgentSessionsByPaneKey[record.paneKey]).toBe(record)
  })

  it('does not fork when the same provider session is already live', async () => {
    const record = makeRecord()
    useAppStore.setState({
      tabsByWorktree: { 'wt-1': [makeTerminalTab('old-tab'), makeTerminalTab('live-tab')] },
      agentStatusByPaneKey: {
        'live-tab:leaf-1': {
          state: 'working',
          prompt: record.prompt,
          updatedAt: 10,
          stateStartedAt: 10,
          agentType: record.agent,
          paneKey: 'live-tab:leaf-1',
          worktreeId: 'wt-1',
          tabId: 'live-tab',
          providerSession: record.providerSession
        }
      },
      sleepingAgentSessionsByPaneKey: { [record.paneKey]: record }
    } as never)
    expect(await resumeSleepingAgentSessionsForWorktree('wt-1')).toBe(0)
    expect(useAppStore.getState().tabsByWorktree['wt-1']).toHaveLength(2)
    expect(useAppStore.getState().sleepingAgentSessionsByPaneKey[record.paneKey]).toBeUndefined()
  })

  it('does not let another worktree claim block the same provider session id', async () => {
    const record = makeRecord()
    useAppStore.setState({
      tabsByWorktree: {
        'wt-1': [],
        'wt-2': [{ ...makeTerminalTab('claimed-tab'), worktreeId: 'wt-2' }]
      },
      automaticAgentResumeClaimsByTabId: {
        'claimed-tab': {
          worktreeId: 'wt-2',
          launchAgent: record.agent,
          providerSession: record.providerSession
        }
      },
      sleepingAgentSessionsByPaneKey: { [record.paneKey]: record }
    } as never)

    expect(await resumeSleepingAgentSessionsForWorktree('wt-1')).toBe(1)
    expect(useAppStore.getState().tabsByWorktree['wt-1']).toHaveLength(1)
    expect(useAppStore.getState().tabsByWorktree['wt-2']).toHaveLength(1)
  })

  it('clears runtime automatic-resume claims when the tab closes', async () => {
    const record = makeRecord()
    useAppStore.setState({
      tabsByWorktree: { 'wt-1': [] },
      sleepingAgentSessionsByPaneKey: { [record.paneKey]: record }
    } as never)

    expect(await resumeSleepingAgentSessionsForWorktree('wt-1')).toBe(1)
    const resumedTab = useAppStore.getState().tabsByWorktree['wt-1']![0]!
    expect(useAppStore.getState().automaticAgentResumeClaimsByTabId[resumedTab.id]).toBeDefined()

    useAppStore.getState().closeTab(resumedTab.id)

    expect(useAppStore.getState().automaticAgentResumeClaimsByTabId[resumedTab.id]).toBeUndefined()
  })

  it('does not include runtime automatic-resume claims in workspace-session payloads', async () => {
    useAppStore.setState({
      tabsByWorktree: { 'wt-1': [makeTerminalTab('tab-1')] },
      automaticAgentResumeClaimsByTabId: {
        'tab-1': {
          worktreeId: 'wt-1',
          launchAgent: 'codex',
          providerSession: { key: 'session_id', id: 'sess-1' }
        }
      }
    } as never)

    const payload = buildWorkspaceSessionPayload(useAppStore.getState())

    expect('automaticAgentResumeClaimsByTabId' in payload).toBe(false)
  })

  it('leaves explicit AI Vault resumes outside automatic-resume claims', async () => {
    useAppStore.setState({ tabsByWorktree: { 'wt-1': [] } } as never)

    const first = launchAiVaultSessionInNewTab({
      agent: 'codex',
      worktreeId: 'wt-1',
      command: "codex resume 'sess-1'",
      launchConfig: { agentArgs: '', agentEnv: {} }
    })
    const second = launchAiVaultSessionInNewTab({
      agent: 'codex',
      worktreeId: 'wt-1',
      command: "codex resume 'sess-1'",
      launchConfig: { agentArgs: '', agentEnv: {} }
    })

    expect(first.tabId).not.toBe(second.tabId)
    expect(useAppStore.getState().tabsByWorktree['wt-1']).toHaveLength(2)
    expect(useAppStore.getState().automaticAgentResumeClaimsByTabId).toEqual({})
  })
})

describe('getWorktreeIdsNeedingStartupResume', () => {
  it('sweeps persisted worktrees, always includes active, and skips completed passes', () => {
    const records = {
      'tab-1:leaf-1': makeRecord({ paneKey: 'tab-1:leaf-1', worktreeId: 'wt-active' }),
      'tab-2:leaf-1': makeRecord({ paneKey: 'tab-2:leaf-1', worktreeId: 'wt-background' }),
      'tab-3:leaf-1': makeRecord({ paneKey: 'tab-3:leaf-1', worktreeId: 'wt-background' })
    }
    expect(getWorktreeIdsNeedingStartupResume(records, 'wt-active', new Set())).toEqual([
      'wt-active',
      'wt-background'
    ])
    expect(getWorktreeIdsNeedingStartupResume({}, 'wt-empty', new Set())).toEqual(['wt-empty'])
    expect(
      getWorktreeIdsNeedingStartupResume(
        records,
        'wt-active',
        new Set(['wt-active', 'wt-background'])
      )
    ).toEqual([])
  })
})
