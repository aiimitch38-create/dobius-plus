import { describe, expect, it } from 'vitest'
import { collectExternalBackupSources } from './external-backup-sources'

describe('collectExternalBackupSources', () => {
  it('includes local repos with their display name as the folder label', () => {
    expect(
      collectExternalBackupSources({
        repos: [{ path: '/repos/alpha', displayName: 'Alpha', connectionId: null }],
        workspaceDir: ''
      })
    ).toEqual([{ path: '/repos/alpha', label: 'Alpha' }])
  })

  it('skips remote repos, whose files are not on this machine', () => {
    expect(
      collectExternalBackupSources({
        repos: [{ path: '/repos/remote', displayName: 'Remote', connectionId: 'ssh-1' }],
        workspaceDir: ''
      })
    ).toEqual([])
  })

  it('adds the workspace root so out-of-tree worktrees are covered', () => {
    const sources = collectExternalBackupSources({ repos: [], workspaceDir: '/work/trees' })
    expect(sources).toEqual([{ path: '/work/trees', label: 'Workspaces' }])
  })

  it('does not mirror the same path twice when it is both a repo and the workspace root', () => {
    const sources = collectExternalBackupSources({
      repos: [{ path: '/work/trees', displayName: 'Alpha', connectionId: null }],
      workspaceDir: '/work/trees/'
    })
    expect(sources).toHaveLength(1)
    expect(sources[0]?.label).toBe('Alpha')
  })

  it('ignores an unset workspace root instead of mirroring the whole filesystem', () => {
    expect(collectExternalBackupSources({ repos: [], workspaceDir: '   ' })).toEqual([])
  })
})
