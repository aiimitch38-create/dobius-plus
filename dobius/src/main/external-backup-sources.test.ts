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

  it('disambiguates sources whose labels would land in the same backup folder', () => {
    const sources = collectExternalBackupSources({
      repos: [
        { path: '/a/alpha', displayName: 'Alpha', connectionId: null },
        { path: '/b/alpha', displayName: 'Alpha', connectionId: null },
        // "a/b" sanitizes to "a-b", so it collides with a literal "a-b" label.
        { path: '/c/one', displayName: 'a-b', connectionId: null },
        { path: '/c/two', displayName: 'a/b', connectionId: null }
      ],
      workspaceDir: ''
    })
    expect(sources).toEqual([
      { path: '/a/alpha', label: 'Alpha' },
      { path: '/b/alpha', label: 'Alpha-2' },
      { path: '/c/one', label: 'a-b' },
      { path: '/c/two', label: 'a-b-2' }
    ])
  })

  it('ignores an unset workspace root instead of mirroring the whole filesystem', () => {
    expect(collectExternalBackupSources({ repos: [], workspaceDir: '   ' })).toEqual([])
  })
})
