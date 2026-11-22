import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PR_HANDLERS } from './pr'

const callMock = vi.fn()
let logSpy: ReturnType<typeof vi.spyOn>

function ok(result: unknown): {
  id: string
  ok: true
  result: unknown
  _meta: { runtimeId: string }
} {
  return { id: 'req', ok: true, result, _meta: { runtimeId: 'rt-1' } }
}

function ctx(flags: Record<string, string | boolean>, json = false): never {
  return {
    flags: new Map(Object.entries({ worktree: 'id:wt1', ...flags })),
    client: { call: callMock, isRemote: false },
    cwd: '/tmp',
    json
  } as never
}

function printed(): string {
  return logSpy.mock.calls.map((call) => String(call[0])).join('\n')
}

const worktree = ok({
  worktree: {
    id: 'repo1::/w',
    repoId: 'repo1',
    linkedPR: null,
    git: {
      path: '/w',
      head: 'abc123',
      branch: 'refs/heads/feature',
      isBare: false,
      isMainWorktree: false
    }
  }
})

const pr = {
  number: 7,
  title: 'Fix login',
  state: 'open',
  url: 'https://github.com/o/r/pull/7',
  checksStatus: 'failure',
  updatedAt: '',
  mergeable: 'MERGEABLE',
  headSha: 'abc123',
  prRepo: { owner: 'o', repo: 'r' }
}

const prLookup = [
  'github.prForBranch',
  { repo: 'id:repo1', branch: 'feature', linkedPRNumber: null, currentHeadOid: 'abc123' },
  { timeoutMs: 120_000 }
]

beforeEach(() => {
  callMock.mockReset()
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  logSpy.mockRestore()
})

describe('dobius pr show', () => {
  it('looks up the PR for the worktree branch', async () => {
    callMock.mockResolvedValueOnce(worktree).mockResolvedValueOnce(ok(pr))
    await PR_HANDLERS['pr show'](ctx({}))
    expect(callMock.mock.calls[0]).toEqual(['worktree.show', { worktree: 'id:wt1' }])
    expect(callMock.mock.calls[1]).toEqual(prLookup)
    expect(printed()).toContain('PR #7: Fix login')
  })

  it('forwards --pr as the linked PR number and prints raw JSON', async () => {
    callMock.mockResolvedValueOnce(worktree).mockResolvedValueOnce(ok(pr))
    await PR_HANDLERS['pr show'](ctx({ pr: '9' }, true))
    expect(callMock.mock.calls[1][1]).toMatchObject({ linkedPRNumber: 9 })
    expect(JSON.parse(printed())).toEqual(ok(pr))
  })

  it('says so plainly when the branch has no PR', async () => {
    callMock.mockResolvedValueOnce(worktree).mockResolvedValueOnce(ok(null))
    await PR_HANDLERS['pr show'](ctx({}))
    expect(printed()).toBe('No pull request found for branch feature.')
  })

  it('refuses a detached HEAD', async () => {
    callMock.mockResolvedValueOnce(
      ok({ worktree: { repoId: 'repo1', linkedPR: null, git: { head: 'abc', branch: '' } } })
    )
    await expect(PR_HANDLERS['pr show'](ctx({}))).rejects.toThrow(/not on a branch/)
  })
})

describe('dobius pr checks', () => {
  const checks = [
    { name: 'build', status: 'completed', conclusion: 'failure', url: 'u1', checkRunId: 11 },
    { name: 'lint', status: 'completed', conclusion: 'success', url: null }
  ]

  it('lists checks for the PR head commit', async () => {
    callMock
      .mockResolvedValueOnce(worktree)
      .mockResolvedValueOnce(ok(pr))
      .mockResolvedValueOnce(ok(checks))
    await PR_HANDLERS['pr checks'](ctx({}))
    expect(callMock.mock.calls[2]).toEqual([
      'github.prChecks',
      { repo: 'id:repo1', prNumber: 7, headSha: 'abc123', prRepo: { owner: 'o', repo: 'r' } },
      { timeoutMs: 120_000 }
    ])
    expect(printed()).toContain('2 checks, 1 failing')
  })

  it('--check fetches details for the named check', async () => {
    callMock
      .mockResolvedValueOnce(worktree)
      .mockResolvedValueOnce(ok(pr))
      .mockResolvedValueOnce(ok(checks))
      .mockResolvedValueOnce(
        ok({
          name: 'build',
          status: 'completed',
          conclusion: 'failure',
          url: 'u1',
          detailsUrl: null,
          startedAt: null,
          completedAt: null,
          title: null,
          summary: null,
          text: null,
          annotations: [
            {
              path: 'a.ts',
              startLine: 3,
              endLine: 3,
              annotationLevel: 'failure',
              title: null,
              message: 'Type error',
              rawDetails: null
            }
          ],
          jobs: []
        })
      )
    await PR_HANDLERS['pr checks'](ctx({ check: 'BUILD' }))
    expect(callMock.mock.calls[3]).toEqual([
      'github.prCheckDetails',
      {
        repo: 'id:repo1',
        checkName: 'build',
        url: 'u1',
        checkRunId: 11,
        prRepo: { owner: 'o', repo: 'r' }
      },
      { timeoutMs: 120_000 }
    ])
    expect(printed()).toContain('a.ts:3: Type error')
  })

  it('names the available checks when --check matches none', async () => {
    callMock
      .mockResolvedValueOnce(worktree)
      .mockResolvedValueOnce(ok(pr))
      .mockResolvedValueOnce(ok(checks))
    await expect(PR_HANDLERS['pr checks'](ctx({ check: 'deploy' }))).rejects.toThrow(
      /Checks: build, lint/
    )
  })

  it('errors with pr_not_found when there is no PR', async () => {
    callMock.mockResolvedValueOnce(worktree).mockResolvedValueOnce(ok(null))
    await expect(PR_HANDLERS['pr checks'](ctx({}))).rejects.toMatchObject({ code: 'pr_not_found' })
  })
})

describe('dobius pr comments', () => {
  const comments = [
    {
      id: 1,
      author: 'sam',
      authorAvatarUrl: '',
      body: 'Looks good',
      createdAt: '2026-11-20T00:00:00Z',
      url: ''
    },
    {
      id: 2,
      author: 'bot',
      authorAvatarUrl: '',
      body: 'Null check',
      createdAt: '2026-11-21T00:00:00Z',
      url: '',
      path: 'a.ts',
      line: 4,
      threadId: 't1',
      isResolved: false
    },
    {
      id: 3,
      author: 'sam',
      authorAvatarUrl: '',
      body: 'Done',
      createdAt: '2026-11-21T00:00:00Z',
      url: '',
      threadId: 't2',
      isResolved: true
    }
  ]

  it('reads comments and --unresolved keeps only open threads', async () => {
    callMock
      .mockResolvedValueOnce(worktree)
      .mockResolvedValueOnce(ok(pr))
      .mockResolvedValueOnce(ok(comments))
    await PR_HANDLERS['pr comments'](ctx({ unresolved: true }, true))
    expect(callMock.mock.calls[2]).toEqual([
      'github.prComments',
      { repo: 'id:repo1', prNumber: 7, prRepo: { owner: 'o', repo: 'r' } },
      { timeoutMs: 120_000 }
    ])
    expect(JSON.parse(printed()).result.map((c: { id: number }) => c.id)).toEqual([2])
  })
})

describe('dobius pr create', () => {
  const cleanStatus = ok({
    entries: [],
    conflictOperation: 'unknown',
    upstreamStatus: { hasUpstream: true, ahead: 0, behind: 0 }
  })
  const eligible = ok({
    provider: 'github',
    review: null,
    canCreate: true,
    blockedReason: null,
    nextAction: null,
    defaultBaseRef: 'origin/main',
    head: 'feature'
  })

  it('checks eligibility with live git state, then creates the PR', async () => {
    callMock
      .mockResolvedValueOnce(worktree)
      .mockResolvedValueOnce(cleanStatus)
      .mockResolvedValueOnce(eligible)
      .mockResolvedValueOnce(ok({ ok: true, number: 8, url: 'https://github.com/o/r/pull/8' }))
    await PR_HANDLERS['pr create'](ctx({ title: ' Fix login ', body: 'Why', draft: true }))
    expect(callMock.mock.calls[2]).toEqual([
      'hostedReview.getCreationEligibility',
      {
        repo: 'id:repo1',
        worktree: 'id:wt1',
        branch: 'feature',
        base: null,
        hasUncommittedChanges: false,
        hasUpstream: true,
        ahead: 0,
        behind: 0,
        linkedGitHubPR: null
      },
      { timeoutMs: 120_000 }
    ])
    expect(callMock.mock.calls[3]).toEqual([
      'hostedReview.create',
      {
        repo: 'id:repo1',
        worktree: 'id:wt1',
        provider: 'github',
        base: 'main',
        head: 'feature',
        title: 'Fix login',
        body: 'Why',
        draft: true
      },
      { timeoutMs: 120_000 }
    ])
    expect(printed()).toBe('Opened PR #8: https://github.com/o/r/pull/8')
  })

  it('stops with a plain reason when the branch needs a push, and never creates', async () => {
    callMock
      .mockResolvedValueOnce(worktree)
      .mockResolvedValueOnce(cleanStatus)
      .mockResolvedValueOnce(
        ok({
          provider: 'github',
          review: null,
          canCreate: false,
          blockedReason: 'needs_push',
          nextAction: 'push',
          defaultBaseRef: 'main'
        })
      )
    await expect(PR_HANDLERS['pr create'](ctx({ title: 'x' }))).rejects.toMatchObject({
      code: 'pr_create_blocked',
      message: expect.stringMatching(/the CLI does not push/)
    })
    expect(callMock.mock.calls.map((call) => call[0])).not.toContain('hostedReview.create')
  })

  it('maps a failed create to an error', async () => {
    callMock
      .mockResolvedValueOnce(worktree)
      .mockResolvedValueOnce(cleanStatus)
      .mockResolvedValueOnce(eligible)
      .mockResolvedValueOnce(ok({ ok: false, code: 'validation', error: 'Title too long' }))
    await expect(PR_HANDLERS['pr create'](ctx({ title: 'x' }))).rejects.toMatchObject({
      code: 'pr_create_failed',
      message: 'Could not open the PR: Title too long'
    })
  })

  it('requires a title before calling the runtime', async () => {
    await expect(PR_HANDLERS['pr create'](ctx({ title: '  ' }))).rejects.toThrow(/needs a title/)
    expect(callMock).not.toHaveBeenCalled()
  })

  it('has no merge command', () => {
    expect(Object.keys(PR_HANDLERS).some((key) => key.includes('merge'))).toBe(false)
  })
})

describe('untrusted text in human output', () => {
  it('strips terminal escape codes from PR comments', async () => {
    callMock
      .mockResolvedValueOnce(worktree)
      .mockResolvedValueOnce(ok(pr))
      .mockResolvedValueOnce(
        ok([
          {
            id: 1,
            author: 'x\u001b[2Jy',
            authorAvatarUrl: '',
            body: 'hi\u001b]0;pwned\u0007 there\r',
            createdAt: '2026-11-20T00:00:00Z',
            url: ''
          }
        ])
      )
    await PR_HANDLERS['pr comments'](ctx({}))
    const out = printed()
    expect(out).not.toContain('\u001b')
    expect(out).toContain('xy, 2026-11-20')
    expect(out).toContain('hi there')
  })
})
