import { describe, expect, it, vi } from 'vitest'
import { resolveCurrentWorktreeSelector } from './selectors'

function client(worktrees: unknown[], repos: unknown[] = []): never {
  const call = vi.fn(async (method: string) => {
    if (method === 'worktree.list') {
      return { result: { worktrees } }
    }
    if (method === 'repo.list') {
      return { result: { repos } }
    }
    throw new Error(`unexpected ${method}`)
  })
  return { call, isRemote: false } as never
}

describe('resolveCurrentWorktreeSelector only picks this machine', () => {
  it('skips an SSH worktree whose remote path matches the cwd', async () => {
    const c = client([
      { id: 'ssh-wt', repoId: 'r2', path: '/work/app', hostId: 'ssh:box' },
      { id: 'local-wt', repoId: 'r1', path: '/work/app', hostId: 'local' }
    ])
    await expect(resolveCurrentWorktreeSelector('/work/app/src', c)).resolves.toBe('id:local-wt')
  })

  it('prefers a shorter local worktree over a longer remote one', async () => {
    const c = client([
      { id: 'local-wt', repoId: 'r1', path: '/work', hostId: 'local' },
      { id: 'ssh-wt', repoId: 'r2', path: '/work/app', hostId: 'ssh:box' }
    ])
    await expect(resolveCurrentWorktreeSelector('/work/app', c)).resolves.toBe('id:local-wt')
  })

  it('uses the repo connection when a worktree record has no hostId', async () => {
    const c = client(
      [
        { id: 'old-ssh-wt', repoId: 'r2', path: '/work/app' },
        { id: 'old-local-wt', repoId: 'r1', path: '/work/app' }
      ],
      [
        { id: 'r2', connectionId: 'box' },
        { id: 'r1', connectionId: null }
      ]
    )
    await expect(resolveCurrentWorktreeSelector('/work/app', c)).resolves.toBe('id:old-local-wt')
  })

  it('reports not found when only a remote worktree matches', async () => {
    const c = client([{ id: 'ssh-wt', repoId: 'r2', path: '/work/app', hostId: 'ssh:box' }])
    await expect(resolveCurrentWorktreeSelector('/work/app', c)).rejects.toThrow(
      /No Dobius-managed worktree contains/
    )
  })
})
