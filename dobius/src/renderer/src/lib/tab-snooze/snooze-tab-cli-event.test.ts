import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SnoozeTabRequest } from '../../../../shared/tab-snooze-types'

vi.mock('@/store', () => ({ useAppStore: { getState: () => ({}) } }))
vi.mock('@/store/slices/agent-status', () => ({
  collectSleepingAgentSessionRecordsForWorktree: () => ({})
}))
vi.mock('@/components/terminal/terminal-tab-actions', () => ({ closeTerminalTab: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { handleTabSnoozeCliEvent, resetTabSnoozeCliHandlerForTest } from './snooze-tab-cli-event'
import type { SnoozeTabDeps } from './snooze-terminal-tab'

const LEAF = '11111111-1111-4111-8111-111111111111'

function harness(working: boolean) {
  const setSnoozeTabConfirm = vi.fn()
  const state = {
    tabsByWorktree: {
      'wt-1': [{ id: 'tab-1', ptyId: 'pty-1', worktreeId: 'wt-1', title: 'claude', customTitle: null, color: null, sortOrder: 0, createdAt: 1 }]
    },
    unifiedTabsByWorktree: { 'wt-1': [{ id: 'u-1', contentType: 'terminal', entityId: 'tab-1', isPinned: false }] },
    terminalLayoutsByTabId: {
      'tab-1': { root: { type: 'leaf', leafId: LEAF }, activeLeafId: LEAF, expandedLeafId: null }
    },
    agentStatusByPaneKey: working ? { [`tab-1:${LEAF}`]: { paneKey: `tab-1:${LEAF}`, state: 'working' } } : {},
    setSnoozeTabConfirm
  }
  const requests: SnoozeTabRequest[] = []
  const closed: string[] = []
  const deps: SnoozeTabDeps = {
    getState: () => state as never,
    captureOutput: () => undefined,
    collectAgentSessions: () => ({}),
    api: {
      add: async (request) => {
        requests.push(request)
        return { ok: true, entry: { ...request, snoozedAt: 1, ready: false } as never }
      },
      discard: vi.fn(async () => true)
    },
    closeTab: (id) => closed.push(id),
    notify: () => undefined
  }
  return { deps, requests, closed, setSnoozeTabConfirm }
}

let seq = 0
const event = (over: Record<string, unknown> = {}) => {
  seq += 1
  return { requestId: `r${seq}`, tabId: 'tab-1', until: 5000, ...over }
}

describe('handleTabSnoozeCliEvent', () => {
  beforeEach(() => resetTabSnoozeCliHandlerForTest())

  it('snoozes an idle tab and reports its worktree', async () => {
    const h = harness(false)
    expect(await handleTabSnoozeCliEvent(event(), h.deps)).toMatchObject({ ok: true, worktreeId: 'wt-1', tabId: 'tab-1' })
    expect(h.closed).toEqual(['tab-1'])
  })

  it('refuses a working tab without opening the confirm dialog, and snoozes it with force', async () => {
    const h = harness(true)
    expect(await handleTabSnoozeCliEvent(event(), h.deps)).toMatchObject({ ok: false, code: 'tab_agent_working' })
    expect(h.setSnoozeTabConfirm).not.toHaveBeenCalled()
    expect(h.closed).toEqual([])
    expect(await handleTabSnoozeCliEvent(event({ force: true }), h.deps)).toMatchObject({ ok: true })
  })

  it('reports an unknown tab and acts once per requestId', async () => {
    const h = harness(false)
    expect(await handleTabSnoozeCliEvent(event({ tabId: 'nope' }), h.deps)).toMatchObject({ ok: false, code: 'tab_not_found' })
    const once = event()
    await handleTabSnoozeCliEvent(once, h.deps)
    expect(await handleTabSnoozeCliEvent(once, h.deps)).toMatchObject({ ok: false })
    expect(h.requests).toHaveLength(1)
  })
})
