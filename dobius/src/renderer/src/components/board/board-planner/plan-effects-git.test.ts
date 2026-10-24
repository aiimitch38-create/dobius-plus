import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: string[] = []
const state = {
  settings: null,
  repos: [{ id: 'repo', connectionId: null }],
  getKnownWorktreeById: () => ({ id: 'wt', repoId: 'repo', path: '/work/wt' }),
  pushBranch: vi.fn(async () => {
    calls.push('push')
  }),
  pullBranch: vi.fn(async () => {
    calls.push('pull')
  })
}

vi.mock('@/store', () => ({ useAppStore: { getState: () => state } }))
vi.mock('@/lib/repo-runtime-owner', () => ({ getRepoOwnerRoutedSettings: (s: unknown) => s }))
vi.mock('@/runtime/runtime-git-client', () => ({
  getRuntimeGitStatus: async () => ({
    entries: [{ path: 'a.ts', area: 'unstaged', status: 'modified' }],
    conflictOperation: 'unknown',
    upstreamStatus: { hasUpstream: true, upstreamName: 'origin/wt', ahead: 0, behind: 0 }
  }),
  bulkStageRuntimeGitPaths: async () => {
    calls.push('stage')
  },
  commitRuntimeGit: async () => {
    calls.push('commit')
    return { success: true }
  }
}))

const { gitEffect } = await import('./plan-effects-git')

describe('gitEffect', () => {
  beforeEach(() => {
    calls.length = 0
  })

  it('shows the exact commands and runs nothing when the user cancels', async () => {
    const confirm = vi.fn(
      async (_options: {
        description?: string
        details?: readonly string[]
        confirmVariant?: string
      }) => false
    )
    const result = await gitEffect('wt', confirm)('commit_push', 'fix login')
    expect(result.ok).toBe(false)
    expect(calls).toEqual([])
    expect(confirm).toHaveBeenCalledTimes(1)
    const shown = confirm.mock.calls[0]?.[0]
    // Each command is its own entry, rendered one per line in a monospace block.
    expect(shown?.description).toBe('In /work/wt:')
    expect(shown?.details).toEqual([
      'git add -- a.ts',
      'git commit -m "fix login"',
      'git push --set-upstream origin HEAD:wt'
    ])
    expect(shown?.confirmVariant).toBe('destructive')
  })

  it('stages, commits and pushes in order once confirmed', async () => {
    const result = await gitEffect('wt', async () => true)('commit_push', 'fix login')
    expect(result.ok).toBe(true)
    expect(calls).toEqual(['stage', 'commit', 'push'])
  })

  it('never asks or runs when the step cannot be planned', async () => {
    const confirm = vi.fn(async () => true)
    const result = await gitEffect('wt', confirm)('commit', null)
    expect(result.ok).toBe(false)
    expect(confirm).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })
})
