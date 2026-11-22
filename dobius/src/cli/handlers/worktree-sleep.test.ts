import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WORKTREE_HANDLERS, isSleepingSummary } from './worktree'
import { TERMINAL_HANDLERS } from './terminal'

const callMock = vi.fn()
let logSpy: ReturnType<typeof vi.spyOn>
const savedWorktreeId = process.env.DOBIUS_WORKTREE_ID

beforeEach(() => {
  callMock.mockReset()
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  delete process.env.DOBIUS_WORKTREE_ID
})

afterEach(() => {
  logSpy.mockRestore()
  if (savedWorktreeId === undefined) {
    delete process.env.DOBIUS_WORKTREE_ID
  } else {
    process.env.DOBIUS_WORKTREE_ID = savedWorktreeId
  }
})

function ctx(flags: Record<string, string | boolean>, json = true): never {
  return {
    flags: new Map(Object.entries(flags)),
    client: { call: callMock, isRemote: false },
    cwd: '/tmp',
    json
  } as never
}

function ok<T>(result: T) {
  return { id: 'r', ok: true, result, _meta: { runtimeId: 'rt' } }
}

function printedJson(): { result: Record<string, unknown> } {
  return JSON.parse(String(logSpy.mock.calls.at(-1)?.[0]))
}

const summary = (worktreeId: string, extra: Record<string, unknown> = {}) => ({
  worktreeId,
  isArchived: false,
  liveTerminalCount: 0,
  hasAttachedPty: false,
  ...extra
})

describe('dobius worktree list --sleeping', () => {
  it('keeps only worktrees with nothing live, and applies --limit after the filter', async () => {
    callMock
      .mockResolvedValueOnce(
        ok({
          worktrees: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
          totalCount: 4,
          truncated: false
        })
      )
      .mockResolvedValueOnce(
        ok({
          worktrees: [
            summary('a', { liveTerminalCount: 2 }),
            summary('b'),
            summary('c'),
            summary('d', { isArchived: true })
          ]
        })
      )
    await WORKTREE_HANDLERS['worktree list'](ctx({ sleeping: true, limit: '1' }))
    expect(callMock.mock.calls[0]).toEqual(['worktree.list', { repo: undefined, limit: 10_000 }])
    expect(callMock.mock.calls[1]).toEqual(['worktree.ps', { limit: 10_000 }])
    expect(printedJson().result).toEqual({
      worktrees: [{ id: 'b' }],
      totalCount: 2,
      truncated: true
    })
  })

  it('without --sleeping is the plain list call', async () => {
    callMock.mockResolvedValueOnce(ok({ worktrees: [], totalCount: 0, truncated: false }))
    await WORKTREE_HANDLERS['worktree list'](ctx({ repo: 'id:r1' }))
    expect(callMock.mock.calls).toEqual([['worktree.list', { repo: 'id:r1', limit: undefined }]])
  })

  it('an attached PTY counts as awake', () => {
    expect(isSleepingSummary(summary('x', { hasAttachedPty: true }) as never)).toBe(false)
    expect(isSleepingSummary(summary('x') as never)).toBe(true)
  })
})

describe('dobius worktree sleep', () => {
  it('resolves the selector, then sleeps by exact id', async () => {
    callMock
      .mockResolvedValueOnce(ok({ worktree: { id: 'repo1::/w/feat' } }))
      .mockResolvedValueOnce(ok({ worktreeId: 'repo1::/w/feat' }))
    await WORKTREE_HANDLERS['worktree sleep'](ctx({ worktree: 'branch:feat' }))
    expect(callMock.mock.calls).toEqual([
      ['worktree.show', { worktree: 'branch:feat' }],
      ['worktree.sleep', { worktree: 'id:repo1::/w/feat' }]
    ])
    expect(printedJson().result).toEqual({ worktreeId: 'repo1::/w/feat' })
  })

  it("refuses the caller's own worktree unless --force", async () => {
    process.env.DOBIUS_WORKTREE_ID = 'repo1::/w/feat'
    callMock.mockResolvedValue(ok({ worktree: { id: 'repo1::/w/feat' } }))
    await expect(
      WORKTREE_HANDLERS['worktree sleep'](ctx({ worktree: 'branch:feat' }))
    ).rejects.toThrow(/Refused: this terminal runs inside that worktree/)
    expect(callMock.mock.calls.map((call) => call[0])).toEqual(['worktree.show'])

    callMock.mockReset()
    callMock
      .mockResolvedValueOnce(ok({ worktree: { id: 'repo1::/w/feat' } }))
      .mockResolvedValueOnce(ok({ worktreeId: 'repo1::/w/feat' }))
    await WORKTREE_HANDLERS['worktree sleep'](ctx({ worktree: 'branch:feat', force: true }))
    expect(callMock.mock.calls.map((call) => call[0])).toEqual(['worktree.show', 'worktree.sleep'])
  })

  it('requires --worktree', async () => {
    await expect(WORKTREE_HANDLERS['worktree sleep'](ctx({}))).rejects.toThrow(/worktree/)
    expect(callMock).not.toHaveBeenCalled()
  })
})

describe('dobius worktree wake', () => {
  it('activates the worktree', async () => {
    callMock.mockResolvedValueOnce(ok({ repoId: 'r', worktreeId: 'w', activated: true }))
    await WORKTREE_HANDLERS['worktree wake'](ctx({ worktree: 'id:w' }, false))
    expect(callMock.mock.calls).toEqual([['worktree.activate', { worktree: 'id:w' }]])
    expect(logSpy.mock.calls.at(-1)?.[0]).toBe('Awake: w')
  })
})

describe('dobius terminal agent', () => {
  it('returns terminal.agentStatus for the named terminal', async () => {
    const agentStatus = { handle: 'term_1', isRunningAgent: true, status: 'permission' }
    callMock.mockResolvedValueOnce(ok({ agentStatus }))
    await TERMINAL_HANDLERS['terminal agent'](ctx({ terminal: 'term_1' }))
    expect(callMock.mock.calls).toEqual([['terminal.agentStatus', { terminal: 'term_1' }]])
    expect(printedJson().result).toEqual({ agentStatus })
  })

  it('prints plain text when no agent runs', async () => {
    callMock.mockResolvedValueOnce(
      ok({ agentStatus: { handle: 'term_1', isRunningAgent: false, status: null } })
    )
    await TERMINAL_HANDLERS['terminal agent'](ctx({ terminal: 'term_1' }, false))
    expect(logSpy.mock.calls.at(-1)?.[0]).toBe('term_1: no agent running')
  })

  it('refuses an empty --terminal instead of using the active terminal', async () => {
    await expect(TERMINAL_HANDLERS['terminal agent'](ctx({ terminal: '' }))).rejects.toThrow(
      /--terminal was given without a value/
    )
    expect(callMock).not.toHaveBeenCalled()
  })
})
