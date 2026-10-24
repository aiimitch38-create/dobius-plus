import { describe, expect, it } from 'vitest'
import type { Repo, Worktree } from '../../../../../shared/types'
import { buildHomeRepoRows, formatIdleAge, homeAgentSummary } from './home-repo-rows'

const repo = (id: string, path: string, displayName = ''): Repo =>
  ({ id, path, displayName, badgeColor: '', addedAt: 0 }) as Repo

const wt = (
  id: string,
  repoId: string,
  lastActivityAt: number,
  extra: Partial<Worktree> = {}
): Worktree =>
  ({
    id,
    repoId,
    lastActivityAt,
    isArchived: false,
    branch: 'refs/heads/main',
    path: `/x/${id}`,
    ...extra
  }) as Worktree

const base = {
  activeWorktreeId: null,
  activeRepoId: null,
  boardCardCounts: {}
}

describe('buildHomeRepoRows', () => {
  const repos = [
    repo('a', '/src/alpha', 'alpha'),
    repo('b', '/src/beta', 'beta'),
    repo('c', '/src/gamma/', '')
  ]
  const worktreesByRepo = {
    a: [wt('a1', 'a', 100)],
    b: [wt('b1', 'b', 300), wt('b2', 'b', 50, { branch: 'refs/heads/feature/x' })],
    c: [wt('c1', 'c', 200)]
  }

  it('sorts by most recent activity, then name', () => {
    const rows = buildHomeRepoRows({ ...base, repos, worktreesByRepo })
    expect(rows.map((r) => r.repoId)).toEqual(['b', 'c', 'a'])
  })

  it('puts the active repo first, derived from the active worktree', () => {
    const rows = buildHomeRepoRows({ ...base, repos, worktreesByRepo, activeWorktreeId: 'a1' })
    expect(rows[0]).toMatchObject({ repoId: 'a', isActive: true })
    expect(rows.slice(1).every((r) => !r.isActive)).toBe(true)
  })

  it('falls back to activeRepoId when no worktree is active', () => {
    const rows = buildHomeRepoRows({ ...base, repos, worktreesByRepo, activeRepoId: 'c' })
    expect(rows[0].repoId).toBe('c')
  })

  it('lands on the active worktree, else the most recent, and strips refs/heads/', () => {
    const recent = buildHomeRepoRows({ ...base, repos, worktreesByRepo }).find(
      (r) => r.repoId === 'b'
    )
    expect(recent).toMatchObject({ worktreeId: 'b1', branch: 'main', lastActivityAt: 300 })
    const active = buildHomeRepoRows({
      ...base,
      repos,
      worktreesByRepo,
      activeWorktreeId: 'b2'
    }).find((r) => r.repoId === 'b')
    expect(active).toMatchObject({ worktreeId: 'b2', branch: 'feature/x', isActive: true })
  })

  it('ignores archived worktrees and handles repos without any', () => {
    const rows = buildHomeRepoRows({
      ...base,
      repos: [repo('d', '/src/delta', 'delta')],
      worktreesByRepo: { d: [wt('d1', 'd', 0, { isArchived: true })] }
    })
    expect(rows[0]).toMatchObject({ worktreeId: null, branch: null, lastActivityAt: null })
  })

  it('splits the path and falls back to the folder name', () => {
    const gamma = buildHomeRepoRows({ ...base, repos, worktreesByRepo }).find(
      (r) => r.repoId === 'c'
    )
    expect(gamma).toMatchObject({ name: 'gamma', parentPath: '/src/' })
  })

  it('marks a resumable board session only when the landing board has cards', () => {
    const rows = buildHomeRepoRows({
      ...base,
      repos,
      worktreesByRepo,
      boardCardCounts: { b1: 2, a1: 0 }
    })
    expect(rows.find((r) => r.repoId === 'b')?.hasBoardSession).toBe(true)
    expect(rows.find((r) => r.repoId === 'a')?.hasBoardSession).toBe(false)
  })
})

describe('formatIdleAge', () => {
  const now = 10 * 86_400_000
  it.each([
    [now - 30_000, null],
    [now - 5 * 60_000, '5m'],
    [now - 12 * 3_600_000, '12h'],
    [now - 3 * 86_400_000, '3d'],
    [now - 21 * 86_400_000, '3w']
  ])('%i -> %s', (since, expected) => {
    expect(formatIdleAge(since, now)).toBe(expected)
  })
})

describe('homeAgentSummary', () => {
  it('counts working and unacknowledged waiting tabs across all workspaces', () => {
    const now = 1_000_000
    const entry = (paneKey: string, state: 'working' | 'waiting' | 'done') => ({
      paneKey,
      state,
      prompt: '',
      updatedAt: now - 10,
      stateStartedAt: now - 100
    })
    const summary = homeAgentSummary(
      { w1: [{ id: 't1' }, { id: 't2' }], w2: [{ id: 't3' }, { id: 't4' }] },
      {
        agentStatusByPaneKey: {
          't1:a': entry('t1:a', 'working'),
          't3:a': entry('t3:a', 'waiting'),
          't4:a': entry('t4:a', 'done')
        } as never,
        acknowledgedAgentsByPaneKey: {},
        now,
        staleAfterMs: 60_000
      }
    )
    expect(summary).toEqual({ working: 2, needsYou: 1 })
  })
})
