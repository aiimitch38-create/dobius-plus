import { describe, expect, it, vi } from 'vitest'
import {
  AGENT_RESUME_CLAIM_ENV,
  parseAgentResumeSpawnClaim
} from '../../../../shared/agent-resume-owner'
import type { SleepingAgentSessionRecord } from '../../../../shared/agent-session-resume'
import type { SnoozedTabEntry, TakenSnoozedTab } from '../../../../shared/tab-snooze-types'
import type { BringBackDeps } from './bring-back-snoozed-tab'
import { runBringBackSnoozedTab } from './bring-back-snoozed-tab'

const LEAF = '11111111-1111-4111-8111-111111111111'
const REF = { worktreeId: 'wt-1', tabId: 'tab-old' }
const providerSession = { key: 'session_id' as const, id: 'session-1' }
const owner = {
  authority: { kind: 'local' as const },
  worktreeId: 'wt-1',
  tabId: 'tab-old',
  leafId: LEAF,
  paneKey: `tab-old:${LEAF}`,
  ptyId: 'pty-old',
  launchToken: 'launch-old',
  agent: 'claude' as const,
  providerSession
}
const record: SleepingAgentSessionRecord = {
  paneKey: owner.paneKey,
  tabId: 'tab-old',
  worktreeId: 'wt-1',
  agent: 'claude',
  providerSession,
  prompt: 'fix it',
  state: 'done',
  capturedAt: 20,
  updatedAt: 10,
  connectionId: null,
  resumeOwner: owner
}
const target = {
  worktreeId: 'wt-1',
  authority: { kind: 'local' as const },
  paneRelocation: 'new-pane-in-same-worktree' as const
}

function entry(extra: Partial<SnoozedTabEntry> = {}): SnoozedTabEntry {
  return { ...REF, title: 'Fix login', snoozedAt: 1, until: null, ready: false, ...extra }
}

function harness(
  options: {
    taken?: TakenSnoozedTab | null
    ready?: boolean
    activeWorktreeId?: string | null
    claim?: 'ok' | 'refused'
    plan?: boolean
    conversationIsOpen?: boolean
    tabs?: { id: string; ptyId: string | null }[]
  } = {}
) {
  const calls: Record<string, unknown[][]> = {}
  const log =
    (name: string, result?: unknown) =>
    (...args: unknown[]): unknown => {
      ;(calls[name] ??= []).push(args)
      return result
    }
  const state = {
    workspaceSessionReady: options.ready ?? true,
    activeWorktreeId: options.activeWorktreeId === undefined ? 'wt-1' : options.activeWorktreeId,
    tabsByWorktree: { 'wt-1': options.tabs ?? [] } as Record<
      string,
      { id: string; ptyId: string | null }[]
    >,
    ptyIdsByTabId: {} as Record<string, string[]>,
    terminalLayoutsByTabId: {},
    unifiedTabsByWorktree: {} as Record<string, unknown[]>,
    createTab: (worktreeId: string, _group: unknown, _shell: unknown, opts: { id: string }) => {
      ;(calls.createTab ??= []).push([worktreeId, opts])
      const tab = { id: opts.id, ptyId: null }
      state.tabsByWorktree[worktreeId] = [...(state.tabsByWorktree[worktreeId] ?? []), tab]
      state.unifiedTabsByWorktree[worktreeId] = [
        { id: `u-${opts.id}`, contentType: 'terminal', entityId: opts.id, isPinned: false }
      ]
      return tab
    },
    closeTab: (tabId: string) => {
      ;(calls.closeTab ??= []).push([tabId])
      state.tabsByWorktree['wt-1'] = state.tabsByWorktree['wt-1'].filter((tab) => tab.id !== tabId)
    },
    setActiveTabType: log('setActiveTabType'),
    setTabCustomTitle: log('setTabCustomTitle'),
    setTabColor: log('setTabColor'),
    setTabLayout: log('setTabLayout'),
    queueTabStartupCommand: log('queueTabStartupCommand'),
    claimAutomaticAgentResume: log('claimAutomaticAgentResume'),
    pinTab: log('pinTab'),
    markTerminalTabUnread: log('markTerminalTabUnread'),
    queueSnoozeBringBack: log('queueSnoozeBringBack'),
    trackReturningSnoozedTab: log('trackReturningSnoozedTab')
  }
  const taken =
    options.taken === undefined
      ? { entry: entry({ returning: true }), scrollback: null }
      : options.taken
  const take = vi.fn(async (_ref: unknown, opts?: { returnTabId?: string }) =>
    taken
      ? {
          ...taken,
          entry: { ...taken.entry, returnTabId: taken.entry.returnTabId ?? opts?.returnTabId }
        }
      : null
  )
  const api = {
    take,
    settle: vi.fn(async () => true),
    putBack: vi.fn(async () => true),
    discard: vi.fn(async () => true)
  }
  const claimAgentResume = vi.fn(async () =>
    options.claim === 'refused' ? null : { ok: true as const, token: 'token-1', target }
  )
  const releaseAgentResume = vi.fn(async () => true)
  const notified: string[] = []
  const deps: BringBackDeps = {
    getState: () => state as never,
    api,
    isKnownWorktree: (worktreeId) => worktreeId === 'wt-1',
    claimAgentResume,
    releaseAgentResume,
    buildResumePlan: () =>
      options.plan === false
        ? null
        : ({
            launchCommand: 'claude --resume session-1',
            env: { A: '1' },
            launchConfig: {}
          } as never),
    conversationIsOpen: () => options.conversationIsOpen === true,
    appendTabToOrder: log('appendTabToOrder') as never,
    newId: () => 'tab-new',
    notify: (outcome) => notified.push(outcome)
  }
  return { deps, state, calls, api, claimAgentResume, releaseAgentResume, notified }
}

describe('runBringBackSnoozedTab', () => {
  it('resumes the conversation through the session-claim gate, never as a plain shell', async () => {
    const h = harness({
      taken: { entry: entry({ returning: true, agentSession: record }), scrollback: 'old output' }
    })
    expect(await runBringBackSnoozedTab(h.deps, REF)).toBe('returned')
    expect(h.claimAgentResume).toHaveBeenCalledWith(owner)
    const [tabId, startup] = h.calls.queueTabStartupCommand[0] as [
      string,
      { command: string; env: Record<string, string>; resumeProviderSession: unknown }
    ]
    expect(tabId).toBe('tab-new')
    expect(startup.command).toBe('claude --resume session-1')
    expect(startup.resumeProviderSession).toEqual(providerSession)
    // The claim rides in the spawn env, which is what main checks before it starts the terminal.
    expect(parseAgentResumeSpawnClaim(startup.env[AGENT_RESUME_CLAIM_ENV])).toEqual({
      token: 'token-1',
      owner,
      target
    })
    expect(h.calls.claimAutomaticAgentResume[0]).toEqual([
      'tab-new',
      { worktreeId: 'wt-1', launchAgent: 'claude', providerSession }
    ])
    // The old output comes back above the new prompt.
    const [, layout] = h.calls.setTabLayout[0] as [
      string,
      { buffersByLeafId: Record<string, string> }
    ]
    expect(Object.values(layout.buffersByLeafId)).toEqual(['old output'])
    // Main keeps the entry until the terminal has started.
    expect(h.api.settle).not.toHaveBeenCalled()
    expect(h.calls.trackReturningSnoozedTab[0]).toEqual([
      'tab-new',
      { ref: REF, claim: { token: 'token-1', owner } }
    ])
  })

  it('a refused claim puts the tab back on the shelf instead of opening a plain shell', async () => {
    const h = harness({
      claim: 'refused',
      taken: { entry: entry({ returning: true, agentSession: record }), scrollback: null }
    })
    expect(await runBringBackSnoozedTab(h.deps, REF)).toBe('put-back')
    expect(h.api.putBack).toHaveBeenCalledWith(REF)
    expect(h.calls.createTab).toBeUndefined()
    expect(h.calls.queueTabStartupCommand).toBeUndefined()
  })

  it('a conversation with no owner, or no launch plan, is put back too', async () => {
    const { resumeOwner: _owner, ...ownerless } = record
    const noOwner = harness({
      taken: { entry: entry({ returning: true, agentSession: ownerless }), scrollback: null }
    })
    expect(await runBringBackSnoozedTab(noOwner.deps, REF)).toBe('put-back')
    expect(noOwner.claimAgentResume).not.toHaveBeenCalled()
    expect(noOwner.calls.createTab).toBeUndefined()

    const noPlan = harness({
      plan: false,
      taken: { entry: entry({ returning: true, agentSession: record }), scrollback: null }
    })
    expect(await runBringBackSnoozedTab(noPlan.deps, REF)).toBe('put-back')
    expect(noPlan.releaseAgentResume).toHaveBeenCalledWith('token-1', owner)
    expect(noPlan.calls.createTab).toBeUndefined()
  })

  it('does not open a second copy of a conversation that is already running here', async () => {
    const h = harness({
      conversationIsOpen: true,
      taken: { entry: entry({ returning: true, agentSession: record }), scrollback: null }
    })
    expect(await runBringBackSnoozedTab(h.deps, REF)).toBe('already-open')
    expect(h.api.discard).toHaveBeenCalledWith(REF)
    expect(h.claimAgentResume).not.toHaveBeenCalled()
    expect(h.calls.createTab).toBeUndefined()
  })

  it('Bring back now before the tabs are restored is queued, not lost', async () => {
    const h = harness({ ready: false })
    expect(await runBringBackSnoozedTab(h.deps, REF)).toBe('queued')
    expect(h.calls.queueSnoozeBringBack[0]).toEqual([REF])
    expect(h.api.take).not.toHaveBeenCalled()
    // A timed return just waits for the next look.
    expect(await runBringBackSnoozedTab(h.deps, REF, { onlyReady: true })).toBe('not-available')
    expect(h.api.take).not.toHaveBeenCalled()
  })

  it('a pinned tab comes back pinned, with its name and colour', async () => {
    const h = harness({
      taken: {
        entry: entry({ returning: true, pinned: true, customTitle: 'Deploy', color: '#3b82f6' }),
        scrollback: null
      }
    })
    expect(await runBringBackSnoozedTab(h.deps, REF)).toBe('returned')
    expect(h.calls.pinTab[0]).toEqual(['u-tab-new'])
    expect(h.calls.setTabCustomTitle[0].slice(0, 2)).toEqual(['tab-new', 'Deploy'])
    expect(h.calls.setTabColor[0]).toEqual(['tab-new', '#3b82f6'])
  })

  it('a timed return arrives unread and takes only an entry that is still ready', async () => {
    const h = harness()
    expect(await runBringBackSnoozedTab(h.deps, REF, { onlyReady: true })).toBe('returned')
    expect(h.api.take).toHaveBeenCalledWith(REF, { onlyReady: true, returnTabId: 'tab-new' })
    expect((h.calls.createTab[0][1] as { activate: boolean }).activate).toBe(false)
    expect(h.calls.markTerminalTabUnread[0]).toEqual(['tab-new'])
    // Bring back now in the worktree you are looking at opens it in front.
    const now = harness()
    await runBringBackSnoozedTab(now.deps, REF)
    expect((now.calls.createTab[0][1] as { activate: boolean }).activate).toBe(true)
    expect(now.calls.setActiveTabType[0]).toEqual(['terminal'])
    expect(now.calls.markTerminalTabUnread).toBeUndefined()
  })

  it('does nothing when another window took the entry first', async () => {
    const h = harness({ taken: null })
    expect(await runBringBackSnoozedTab(h.deps, REF, { onlyReady: true })).toBe('not-available')
    expect(h.calls.createTab).toBeUndefined()
  })

  it('leaves an entry alone when this window does not have its worktree', async () => {
    const h = harness()
    expect(await runBringBackSnoozedTab(h.deps, { worktreeId: 'wt-9', tabId: 'tab-1' })).toBe(
      'unknown-worktree'
    )
    expect(h.api.take).not.toHaveBeenCalled()
  })

  it('a retry never trusts a leftover tab: it is replaced by one that resumes the conversation', async () => {
    for (const ptyId of ['pty-plain-shell', null]) {
      const h = harness({
        tabs: [{ id: 'tab-made', ptyId }],
        taken: {
          entry: entry({ returning: true, returnTabId: 'tab-made', agentSession: record }),
          scrollback: null
        }
      })
      expect(await runBringBackSnoozedTab(h.deps, REF, { onlyReady: true })).toBe('returned')
      // Some terminal in the old tab proves nothing about the conversation.
      expect(h.api.settle).not.toHaveBeenCalled()
      expect(h.claimAgentResume).toHaveBeenCalledWith(owner)
      expect(h.calls.closeTab).toEqual([['tab-made']])
      expect(h.calls.createTab[0][1]).toMatchObject({ id: 'tab-made' })
      expect(h.calls.queueTabStartupCommand[0][0]).toBe('tab-made')
    }
  })
})
