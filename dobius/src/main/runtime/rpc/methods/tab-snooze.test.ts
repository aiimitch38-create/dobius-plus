import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SleepingAgentSessionRecord } from '../../../../shared/agent-session-resume'
import type { TabSnoozeCliReply, TabSnoozeCliRequest } from '../../../../shared/tab-snooze-cli'

const admission = vi.hoisted(() => ({
  value: { allowed: true } as { allowed: true } | { allowed: false; reason: 'paused'; message: string }
}))
vi.mock('../../../agents/execution-gate', () => ({
  checkExecutionAdmission: vi.fn(() => admission.value)
}))

import { createTabSnoozeService } from '../../../tab-snooze'
import { setActiveTabSnoozeService } from '../../../tab-snooze-active'
import type { DobiusRuntimeService } from '../../dobius-runtime'
import type { RpcRequest, RpcResponse } from '../core'
import { RpcDispatcher } from '../dispatcher'
import { TAB_SNOOZE_METHODS } from './tab-snooze'

const LEAF = '11111111-1111-4111-8111-111111111111'

function agentSession(tabId: string): SleepingAgentSessionRecord {
  const paneKey = `${tabId}:${LEAF}`
  const providerSession = { key: 'session_id' as const, id: `session-${tabId}` }
  return {
    paneKey,
    tabId,
    worktreeId: 'wt-1',
    agent: 'claude',
    providerSession,
    prompt: 'fix it',
    state: 'done',
    capturedAt: 900,
    updatedAt: 800,
    connectionId: null,
    origin: 'worktree-sleep',
    resumeOwner: {
      authority: { kind: 'local' },
      worktreeId: 'wt-1',
      tabId,
      leafId: LEAF,
      paneKey,
      ptyId: `pty-${tabId}`,
      launchToken: `launch-${tabId}`,
      agent: 'claude',
      providerSession
    }
  }
}

function setup(reply: (event: TabSnoozeCliRequest) => TabSnoozeCliReply | null = () => null) {
  let saved: unknown = []
  const service = createTabSnoozeService({
    load: () => saved,
    save: (entries) => {
      saved = entries
    },
    scrollback: { write: () => null, read: () => null, remove: () => undefined },
    onChange: () => undefined,
    verifyResumeOwner: () => true
  })
  setActiveTabSnoozeService(service)
  const requestTabSnooze = vi.fn(async (event: TabSnoozeCliRequest) => reply(event))
  const runtime = {
    getRuntimeId: () => 'test-runtime',
    showManagedWorktree: vi.fn(async () => ({ id: 'wt-1', path: '/repo/wt-1' })),
    requestTabSnooze
  } as unknown as DobiusRuntimeService
  const dispatcher = new RpcDispatcher({ runtime, methods: TAB_SNOOZE_METHODS })
  const call = async (method: string, params?: unknown) =>
    (await dispatcher.dispatch({ id: 'r', authToken: 't', method, params } as RpcRequest)) as RpcResponse
  return { service, call, requestTabSnooze }
}

const code = (r: RpcResponse) => (r.ok ? null : r.error.code)

describe('tabs snooze RPC methods', () => {
  beforeEach(() => {
    admission.value = { allowed: true }
  })

  it('lists snoozed tabs without resume tokens or saved output', async () => {
    const { service, call } = setup()
    service.add({ worktreeId: 'wt-1', tabId: 'tab-1', title: 'Fix', until: null, agentSession: agentSession('tab-1') })
    const r = await call('tabs.snoozed', {})
    expect(r.ok).toBe(true)
    const [row] = (r as { result: { tabs: Record<string, unknown>[] } }).result.tabs
    expect(row).toMatchObject({ tabId: 'tab-1', hasConversation: true, agent: 'claude', returning: false })
    expect(JSON.stringify(r)).not.toContain('launch-tab-1')
  })

  it('unsnooze marks the entry ready; once a window took it, a second unsnooze is refused', async () => {
    const { service, call } = setup()
    service.add({ worktreeId: 'wt-1', tabId: 'tab-1', title: 'Fix', until: Date.now() + 3_600_000 })
    const first = await call('tabs.unsnooze', { tab: 'tab-1' })
    expect(first).toMatchObject({ ok: true, result: { ready: true } })
    expect(service.list()[0].ready).toBe(true)
    // The window's claim gate hands it out exactly once.
    expect(service.take({ worktreeId: 'wt-1', tabId: 'tab-1' }, { onlyReady: true, rendererId: 7 })).not.toBeNull()
    expect(service.take({ worktreeId: 'wt-1', tabId: 'tab-1' }, { onlyReady: true, rendererId: 8 })).toBeNull()
    const second = await call('tabs.unsnooze', { tab: 'tab-1' })
    expect(code(second)).toBe('tab_snooze_returning')
  })

  it('unsnooze of a tab with a conversation is refused while Pause crew is on', async () => {
    const { service, call } = setup()
    service.add({ worktreeId: 'wt-1', tabId: 'tab-2', title: 'Agent', until: null, agentSession: agentSession('tab-2') })
    admission.value = { allowed: false, reason: 'paused', message: 'Crew is paused.' }
    expect(code(await call('tabs.unsnooze', { tab: 'tab-2' }))).toBe('crew_paused')
    expect(service.list()[0].ready).toBe(false)
  })

  it('unsnooze of an unknown tab is tab_snooze_not_found', async () => {
    const { call } = setup()
    expect(code(await call('tabs.unsnooze', { tab: 'nope' }))).toBe('tab_snooze_not_found')
  })

  it('snooze asks the window and passes its refusal through', async () => {
    const until = Date.now() + 60_000
    const ok = setup((event) => ({ requestId: event.requestId, ok: true, worktreeId: 'wt-1', tabId: event.tabId }))
    expect(await ok.call('tabs.snooze', { tab: 'tab-1', until })).toMatchObject({ ok: true, result: { tabId: 'tab-1' } })
    expect(ok.requestTabSnooze).toHaveBeenCalledWith(expect.objectContaining({ tabId: 'tab-1', until }))
    const busy = setup((event) => ({
      requestId: event.requestId,
      ok: false,
      code: 'tab_agent_working',
      message: 'working'
    }))
    expect(code(await busy.call('tabs.snooze', { tab: 'tab-1', until }))).toBe('tab_agent_working')
    const closed = setup(() => null)
    expect(code(await closed.call('tabs.snooze', { tab: 'tab-1', until: null }))).toBe('tab_snooze_unavailable')
  })

  it('snooze refuses a time in the past', async () => {
    const { call, requestTabSnooze } = setup()
    expect(code(await call('tabs.snooze', { tab: 'tab-1', until: Date.now() - 1000 }))).toBe('tab_snooze_refused')
    expect(requestTabSnooze).not.toHaveBeenCalled()
  })
})
