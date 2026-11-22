import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TABS_HANDLERS } from './tabs'

const callMock = vi.fn()
let logSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  callMock.mockReset()
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  logSpy.mockRestore()
})

function ctx(flags: Record<string, string | boolean>, opts: { json?: boolean; remote?: boolean } = {}): never {
  return {
    flags: new Map(Object.entries(flags)),
    client: { call: callMock, isRemote: opts.remote === true },
    cwd: '/tmp',
    json: opts.json ?? true
  } as never
}

const ok = <T>(result: T) => ({ id: 'r', ok: true, result, _meta: { runtimeId: 'rt' } })

const snapshot = {
  worktree: 'repo::/w/a',
  publicationEpoch: 'e',
  snapshotVersion: 1,
  activeGroupId: null,
  activeTabId: 'tab-1',
  activeTabType: 'terminal',
  tabs: [
    { type: 'terminal', id: 'tab-1', title: 'Claude', status: 'ready', terminal: 'term_1', isActive: true },
    { type: 'terminal', id: 'tab-2', title: 'Shell', status: 'pending-handle', terminal: null, isActive: false },
    { type: 'browser', id: 'tab-3', title: 'Docs', url: 'https://example.com', isActive: false }
  ]
}

describe('dobius tabs list', () => {
  it('lists one worktree via session.tabs.list and prints JSON', async () => {
    callMock.mockResolvedValueOnce(ok(snapshot))
    await TABS_HANDLERS['tabs list'](ctx({ worktree: 'id:repo::/w/a' }))
    expect(callMock.mock.calls).toEqual([['session.tabs.list', { worktree: 'id:repo::/w/a' }]])
    expect(JSON.parse(String(logSpy.mock.calls[0]?.[0])).result.tabs).toHaveLength(3)
  })

  it('prints one line per tab with the terminal handle or "not running"', async () => {
    callMock.mockResolvedValueOnce(ok(snapshot))
    await TABS_HANDLERS['tabs list'](ctx({ worktree: 'id:repo::/w/a' }, { json: false }))
    const text = String(logSpy.mock.calls[0]?.[0])
    expect(text).toContain('* tab-1  terminal  Claude  (term_1)')
    expect(text).toContain('  tab-2  terminal  Shell  (not running)')
    expect(text).toContain('(https://example.com)')
  })

  it('--all uses session.tabs.listAll; --all with --worktree is refused', async () => {
    callMock.mockResolvedValueOnce(ok({ snapshots: [snapshot] }))
    await TABS_HANDLERS['tabs list'](ctx({ all: true }))
    expect(callMock.mock.calls).toEqual([['session.tabs.listAll']])
    callMock.mockReset()
    await expect(TABS_HANDLERS['tabs list'](ctx({ all: true, worktree: 'id:x' }))).rejects.toThrow(
      /either --all or --worktree/
    )
    expect(callMock).not.toHaveBeenCalled()
  })

  it('a remote CLI must name the worktree', async () => {
    await expect(TABS_HANDLERS['tabs list'](ctx({}, { remote: true }))).rejects.toThrow(
      /require --worktree/
    )
    expect(callMock).not.toHaveBeenCalled()
  })
})

describe('dobius tabs activate', () => {
  it('activates the tab in the named worktree', async () => {
    callMock.mockResolvedValueOnce(ok(snapshot))
    await TABS_HANDLERS['tabs activate'](ctx({ worktree: 'id:repo::/w/a', tab: 'tab-2' }))
    expect(callMock.mock.calls).toEqual([
      ['session.tabs.activate', { worktree: 'id:repo::/w/a', tabId: 'tab-2' }]
    ])
  })

  it('requires --tab and refuses an empty --worktree', async () => {
    await expect(TABS_HANDLERS['tabs activate'](ctx({ worktree: 'id:x' }))).rejects.toThrow(
      /Missing required --tab/
    )
    await expect(TABS_HANDLERS['tabs activate'](ctx({ worktree: '', tab: 't' }))).rejects.toThrow(
      /Missing value for --worktree/
    )
    expect(callMock).not.toHaveBeenCalled()
  })
})
