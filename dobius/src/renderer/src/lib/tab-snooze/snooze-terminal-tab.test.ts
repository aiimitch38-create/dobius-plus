import { describe, expect, it, vi } from 'vitest'
import type { SleepingAgentSessionRecord } from '../../../../shared/agent-session-resume'
import type { SnoozeTabRequest, SnoozeTabResult } from '../../../../shared/tab-snooze-types'
import type { TerminalTab } from '../../../../shared/types'

vi.mock('@/store', () => ({ useAppStore: { getState: () => ({}) } }))
vi.mock('@/store/slices/agent-status', () => ({
  collectSleepingAgentSessionRecordsForWorktree: () => ({})
}))
vi.mock('@/components/terminal/terminal-tab-actions', () => ({ closeTerminalTab: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { runTabSnooze } from './snooze-terminal-tab'
import type { SnoozeTabDeps } from './snooze-terminal-tab'

const LEAF = '11111111-1111-4111-8111-111111111111'

function tab(extra: Partial<TerminalTab> = {}): TerminalTab {
  return {
    id: 'tab-1',
    ptyId: 'pty-1',
    worktreeId: 'wt-1',
    title: 'claude',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 1,
    ...extra
  }
}

function session(): SleepingAgentSessionRecord {
  return {
    paneKey: `tab-1:${LEAF}`,
    tabId: 'tab-1',
    worktreeId: 'wt-1',
    agent: 'claude',
    providerSession: { key: 'session_id', id: 'session-1' },
    prompt: 'fix it',
    lastAssistantMessage: 'Done, tests pass.',
    state: 'done',
    capturedAt: 20,
    updatedAt: 10
  }
}

function harness(
  options: {
    tabs?: TerminalTab[]
    pinned?: boolean
    split?: boolean
    working?: boolean
    sessions?: Record<string, SleepingAgentSessionRecord>
    addResult?: SnoozeTabResult
    onAdd?: () => void
  } = {}
) {
  const state = {
    tabsByWorktree: { 'wt-1': options.tabs ?? [tab()] },
    unifiedTabsByWorktree: {
      'wt-1': [
        { id: 'u-1', contentType: 'terminal', entityId: 'tab-1', isPinned: options.pinned === true }
      ]
    },
    terminalLayoutsByTabId: {
      'tab-1': options.split
        ? {
            root: {
              type: 'split',
              direction: 'vertical',
              first: { type: 'leaf', leafId: LEAF },
              second: { type: 'leaf', leafId: '22222222-2222-4222-8222-222222222222' }
            },
            activeLeafId: LEAF,
            expandedLeafId: null
          }
        : {
            root: { type: 'leaf', leafId: LEAF },
            activeLeafId: LEAF,
            expandedLeafId: null,
            buffersByLeafId: { [LEAF]: 'old output' }
          }
    },
    agentStatusByPaneKey: options.working
      ? { [`tab-1:${LEAF}`]: { paneKey: `tab-1:${LEAF}`, state: 'working' } }
      : {},
    setSnoozeTabConfirm: vi.fn()
  }
  const requests: SnoozeTabRequest[] = []
  const calls = { captured: [] as string[], closed: [] as string[], notified: [] as string[] }
  const discard = vi.fn(async () => true)
  const deps: SnoozeTabDeps = {
    getState: () => state as never,
    captureOutput: (id) => calls.captured.push(id),
    collectAgentSessions: () => options.sessions ?? {},
    api: {
      add: async (request) => {
        requests.push(request)
        options.onAdd?.()
        return (
          options.addResult ?? {
            ok: true,
            entry: { ...request, snoozedAt: 1, ready: false } as never
          }
        )
      },
      discard
    },
    closeTab: (id) => calls.closed.push(id),
    notify: (outcome) => calls.notified.push(outcome)
  }
  return { deps, state, requests, calls, discard }
}

describe('runTabSnooze', () => {
  it('saves the tab in main first, then closes it', async () => {
    const h = harness({ sessions: { [`tab-1:${LEAF}`]: session() } })
    expect(await runTabSnooze(h.deps, 'tab-1', 5000)).toBe('snoozed')
    expect(h.calls.captured).toEqual(['tab-1'])
    expect(h.requests[0]).toMatchObject({
      worktreeId: 'wt-1',
      tabId: 'tab-1',
      until: 5000,
      title: 'claude',
      scrollback: 'old output',
      preview: 'Done, tests pass.'
    })
    expect(h.requests[0].agentSession?.providerSession.id).toBe('session-1')
    expect(h.calls.closed).toEqual(['tab-1'])
  })

  it('a pinned tab is saved as pinned so it comes back pinned', async () => {
    const h = harness({ pinned: true })
    await runTabSnooze(h.deps, 'tab-1', null)
    expect(h.requests[0].pinned).toBe(true)
    expect(h.calls.closed).toEqual(['tab-1'])
  })

  it('a tab closed while main was saving does not keep its entry', async () => {
    const h = harness()
    h.deps.api = {
      add: async (request) => {
        h.state.tabsByWorktree['wt-1'] = []
        return { ok: true, entry: { ...request, snoozedAt: 1, ready: false } as never }
      },
      discard: h.discard
    }
    expect(await runTabSnooze(h.deps, 'tab-1', null)).toBe('tab-gone')
    expect(h.discard).toHaveBeenCalledWith({ worktreeId: 'wt-1', tabId: 'tab-1' })
    expect(h.calls.closed).toEqual([])
  })

  it('keeps the tab open when main refuses the entry', async () => {
    const h = harness({ addResult: { ok: false, reason: 'conversation-not-resumable' } })
    expect(await runTabSnooze(h.deps, 'tab-1', null)).toBe('conversation-not-resumable')
    expect(h.calls.closed).toEqual([])
    expect(h.calls.notified).toEqual(['conversation-not-resumable'])
  })

  it('asks first when the tab is mid-work, and says whether it will resume', async () => {
    const h = harness({ working: true })
    expect(await runTabSnooze(h.deps, 'tab-1', 7)).toBe('needs-confirm')
    expect(h.state.setSnoozeTabConfirm).toHaveBeenCalledWith({
      tabId: 'tab-1',
      tabLabel: 'claude',
      until: 7,
      resumes: false
    })
    expect(h.requests).toEqual([])
    expect(await runTabSnooze(h.deps, 'tab-1', 7, { confirmed: true })).toBe('snoozed')
  })

  it('refuses a split tab and leaves it open', async () => {
    const h = harness({ split: true })
    expect(await runTabSnooze(h.deps, 'tab-1', null)).toBe('split-panes')
    expect(h.requests).toEqual([])
    expect(h.calls.closed).toEqual([])
  })

  it('ignores a conversation that belongs to another tab', async () => {
    const other = { ...session(), paneKey: `tab-2:${LEAF}`, tabId: 'tab-2' }
    const h = harness({ sessions: { [other.paneKey]: other } })
    await runTabSnooze(h.deps, 'tab-1', null)
    expect(h.requests[0].agentSession).toBeNull()
  })

  it('a second snooze of the same tab while the first is saving is refused, so the saved entry is never discarded', async () => {
    let release: () => void = () => {}
    const h = harness({ onAdd: () => undefined })
    const add = h.deps.api!.add
    h.deps.api!.add = async (request) => {
      await new Promise<void>((resolve) => (release = resolve))
      return add(request)
    }
    const first = runTabSnooze(h.deps, 'tab-1', null)
    expect(await runTabSnooze(h.deps, 'tab-1', null)).toBe('in-progress')
    release()
    expect(await first).toBe('snoozed')
    expect(h.discard).not.toHaveBeenCalled()
    expect(h.requests).toHaveLength(1)
  })
})
