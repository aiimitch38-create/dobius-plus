import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  sent: [] as string[],
  status: [] as Record<string, unknown>[],
  resumeListeners: [] as (() => void)[],
  files: new Map<string, string>(),
  forgetStarted: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    removeHandler: (channel: string) => mocks.handlers.delete(channel),
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      mocks.handlers.set(channel, handler)
  },
  BrowserWindow: {
    getAllWindows: () => [
      { isDestroyed: () => false, webContents: { send: (c: string) => mocks.sent.push(c) } },
      { isDestroyed: () => true, webContents: { send: () => mocks.sent.push('destroyed') } }
    ]
  },
  powerMonitor: {
    on: (_event: string, listener: () => void) => mocks.resumeListeners.push(listener)
  }
}))

vi.mock('../agent-hooks/server', () => ({
  agentHookServer: { getStatusSnapshot: () => mocks.status }
}))

vi.mock('../pty/agent-resume-claims', () => ({
  mainProcessAgentResumeClaims: { forgetStarted: mocks.forgetStarted }
}))

vi.mock('../terminal-scrollback-snapshots', () => ({
  writeTerminalScrollbackSnapshotSync: (args: {
    tabId: string
    leafId: string
    buffer: string
  }) => {
    const ref = `v1-${'0'.repeat(31)}${mocks.files.size + 1}`
    mocks.files.set(ref, `${args.tabId}|${args.buffer}`)
    return ref
  },
  readTerminalScrollbackSnapshotSync: (ref: string) => mocks.files.get(ref) ?? null,
  deleteTerminalScrollbackSnapshotSync: (ref: string) => mocks.files.delete(ref)
}))

const LEAF = '11111111-1111-4111-8111-111111111111'
const providerSession = { key: 'session_id' as const, id: 'claude-session-1' }
const owner = {
  authority: { kind: 'local' as const },
  worktreeId: 'wt-1',
  tabId: 'tab-1',
  leafId: LEAF,
  paneKey: `tab-1:${LEAF}`,
  ptyId: 'pty-1',
  launchToken: 'launch-1',
  agent: 'claude' as const,
  providerSession
}
const agentSession = {
  paneKey: owner.paneKey,
  tabId: 'tab-1',
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
const liveStatus = {
  paneKey: owner.paneKey,
  ptyId: 'pty-1',
  launchToken: 'launch-1',
  worktreeId: 'wt-1',
  agentType: 'claude',
  connectionId: null,
  providerSession
}

async function setup(session: Record<string, unknown> = {}) {
  vi.resetModules()
  let saved: unknown = []
  const store = {
    getSnoozedTabs: () => saved,
    setSnoozedTabs: (entries: unknown) => {
      saved = entries
    },
    getWorkspaceSession: () => session
  }
  const mod = await import('./tab-snooze')
  mod.registerTabSnoozeHandlers(store as never)
  const call = (channel: string, ...args: unknown[]): unknown =>
    mocks.handlers.get(channel)?.({}, ...args)
  return { mod, call, readSaved: () => saved as Record<string, unknown>[] }
}

beforeEach(() => {
  mocks.handlers.clear()
  mocks.sent.length = 0
  mocks.status.length = 0
  mocks.resumeListeners.length = 0
  mocks.files.clear()
  mocks.forgetStarted.mockReset()
})

describe('tab snooze IPC', () => {
  it('adds, lists and tells every live window', async () => {
    const { call } = await setup()
    const result = call('tabSnooze:add', {
      worktreeId: 'wt-1',
      tabId: 'tab-1',
      title: 'Fix',
      until: null,
      scrollback: 'hello'
    })
    expect(result).toMatchObject({ ok: true })
    expect(call('tabSnooze:list')).toHaveLength(1)
    expect(mocks.sent).toEqual(['tabSnooze:changed'])
    // Kept under its own key so closing the tab cannot delete it.
    expect([...mocks.files.values()][0]).toBe('snoozed-tab:wt-1\0tab-1|hello')
  })

  it('refuses malformed refs on every channel', async () => {
    const { call } = await setup()
    expect(call('tabSnooze:add', { tabId: 'tab-1' })).toEqual({ ok: false, reason: 'invalid' })
    expect(call('tabSnooze:take', 'nope')).toBeNull()
    for (const channel of ['settle', 'putBack', 'setTime', 'discard']) {
      expect(call(`tabSnooze:${channel}`, { worktreeId: 'wt-1' })).toBe(false)
    }
  })

  it('keeps a conversation only while the hook server sees that pane running it', async () => {
    const { call } = await setup()
    const request = { worktreeId: 'wt-1', tabId: 'tab-1', title: 'Fix', until: null, agentSession }
    expect(call('tabSnooze:add', request)).toEqual({
      ok: false,
      reason: 'conversation-not-resumable'
    })
    mocks.status.push({ ...liveStatus, launchToken: 'launch-other' })
    expect(call('tabSnooze:add', request)).toMatchObject({ ok: false })
    mocks.status.length = 0
    mocks.status.push(liveStatus)
    expect(call('tabSnooze:add', request)).toMatchObject({ ok: true })
    // Its finished claim is released so the return can claim the session again.
    expect(mocks.forgetStarted).toHaveBeenCalledWith(owner)
  })

  it('the claim gate recognises a snoozed owner until its tab has started', async () => {
    const { call } = await setup()
    const { isSnoozedTabResumeOwner } = await import('../tab-snooze')
    mocks.status.push(liveStatus)
    const ref = { worktreeId: 'wt-1', tabId: 'tab-1' }
    expect(isSnoozedTabResumeOwner(owner)).toBe(false)
    call('tabSnooze:add', { ...ref, title: 'Fix', until: null, agentSession })
    expect(isSnoozedTabResumeOwner(owner)).toBe(true)
    expect(call('tabSnooze:take', ref, { returnTabId: 'tab-new' })).toMatchObject({
      entry: { returning: true, returnTabId: 'tab-new' }
    })
    expect(call('tabSnooze:take', ref)).toBeNull()
    expect(isSnoozedTabResumeOwner(owner)).toBe(true)
    expect(call('tabSnooze:settle', ref)).toBe(true)
    expect(isSnoozedTabResumeOwner(owner)).toBe(false)
  })

  it('falls back to the output the session saved for a tab that is not on screen', async () => {
    const { call } = await setup({
      terminalLayoutsByTabId: {
        'tab-1': {
          root: { type: 'leaf', leafId: LEAF },
          buffersByLeafId: { [LEAF]: 'saved output' }
        }
      }
    })
    const ref = { worktreeId: 'wt-1', tabId: 'tab-1' }
    call('tabSnooze:add', { ...ref, title: 'Fix', until: null })
    expect(call('tabSnooze:take', ref)).toMatchObject({
      scrollback: 'snoozed-tab:wt-1\0tab-1|saved output'
    })
  })

  it('at launch, due entries turn ready and an interrupted return starts over', async () => {
    vi.resetModules()
    let saved: unknown = [
      { worktreeId: 'wt-1', tabId: 'tab-due', title: 'Due', snoozedAt: 1, until: 2, ready: false },
      {
        worktreeId: 'wt-1',
        tabId: 'tab-cut',
        title: 'Cut',
        snoozedAt: 1,
        until: null,
        ready: false,
        returning: true
      }
    ]
    const store = {
      getSnoozedTabs: () => saved,
      setSnoozedTabs: (entries: unknown) => {
        saved = entries
      },
      getWorkspaceSession: () => ({})
    }
    const mod = await import('./tab-snooze')
    mod.registerTabSnoozeHandlers(store as never)
    const rows = saved as { tabId: string; ready: boolean; returning?: boolean }[]
    expect(rows.map((row) => [row.tabId, row.ready, row.returning])).toEqual([
      ['tab-due', true, undefined],
      ['tab-cut', true, undefined]
    ])
    expect(mocks.resumeListeners).toHaveLength(1)
  })
})
