import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userDataDir: string

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir }
}))

const {
  cloneProjectRepository,
  listProjectLocalRepositories,
  getProjectLocalRepoSnapshot,
  getProjectLocalRepoDiff,
  getProjectRepoSyncStatus,
  pushProjectLocalRepository,
  pullProjectLocalRepository
} = await import('./local-repos')

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
}

function initFixtureRemote(dir: string): void {
  git(dir, ['init', '--quiet', '-b', 'main'])
  git(dir, ['config', 'user.email', 'fixture@example.com'])
  git(dir, ['config', 'user.name', 'Fixture'])
  // Why: this fixture is a non-bare repo standing in for a real remote. A
  // real git host accepts pushes to any branch; a non-bare repo refuses
  // pushes to its currently checked-out branch unless told otherwise.
  git(dir, ['config', 'receive.denyCurrentBranch', 'updateInstead'])
  writeFileSync(path.join(dir, 'README.md'), '# fixture\n')
  git(dir, ['add', 'README.md'])
  git(dir, ['commit', '--quiet', '-m', 'initial commit'])
}

describe('local-repos', () => {
  let workDir: string
  let remoteDir: string
  let cloneUrl: string

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), 'dobius-workstation-local-'))
    userDataDir = path.join(workDir, 'userData')
    mkdirSync(userDataDir, { recursive: true })
    remoteDir = path.join(workDir, 'remote.git')
    mkdirSync(remoteDir)
    initFixtureRemote(remoteDir)
    cloneUrl = remoteDir
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  it('clones a repository into <reposDir>/<projectDtag>, then is idempotent on a second call', async () => {
    const first = await cloneProjectRepository({ projectDtag: 'proj-a', cloneUrl })
    expect(first.cloned).toBe(true)
    expect(first.path.endsWith(path.join('workstation-repos', 'proj-a'))).toBe(true)

    const second = await cloneProjectRepository({ projectDtag: 'proj-a', cloneUrl })
    expect(second.cloned).toBe(false)
  })

  it('rejects a path-traversal projectDtag instead of cloning outside reposDir', async () => {
    await expect(cloneProjectRepository({ projectDtag: '../../escaped', cloneUrl })).rejects.toThrow()
  })

  it('lists only real cloned git repositories', async () => {
    await cloneProjectRepository({ projectDtag: 'proj-a', cloneUrl })
    const repos = await listProjectLocalRepositories({})
    expect(repos).toEqual([{ name: 'proj-a', path: expect.stringContaining('proj-a') }])
  })

  it('returns null for a snapshot/diff of a project that has not been cloned yet', async () => {
    expect(await getProjectLocalRepoSnapshot({ projectDtag: 'never-cloned' })).toBeNull()
    expect(await getProjectLocalRepoDiff({ projectDtag: 'never-cloned' })).toBeNull()
  })

  it('builds a real commit-log snapshot for a cloned repository', async () => {
    await cloneProjectRepository({ projectDtag: 'proj-a', cloneUrl })
    const snapshot = await getProjectLocalRepoSnapshot({ projectDtag: 'proj-a' })
    expect(snapshot).not.toBeNull()
    expect(snapshot?.snapshot.commits).toHaveLength(1)
    expect(snapshot?.snapshot.commits[0]?.subject).toBe('initial commit')
    expect(snapshot?.snapshot.files.map((f) => f.path)).toContain('README.md')
  })

  it('reports sync status with no local clone as blocked, honestly', async () => {
    const status = await getProjectRepoSyncStatus({ projectDtag: 'proj-a', cloneUrl })
    expect(status.local_path).toBeNull()
    expect(status.can_push).toBe(false)
    expect(status.can_pull).toBe(false)
  })

  it('pushes local commits to origin and reports a real ahead/behind sync status afterward', async () => {
    await cloneProjectRepository({ projectDtag: 'proj-a', cloneUrl })
    const localPath = path.join(userDataDir, 'workstation-repos', 'proj-a')
    writeFileSync(path.join(localPath, 'file2.txt'), 'hello\n')
    git(localPath, ['add', 'file2.txt'])
    git(localPath, ['commit', '--quiet', '-m', 'second commit'])

    const pushResult = await pushProjectLocalRepository({ projectDtag: 'proj-a', cloneUrl, branchName: 'main' })
    expect(pushResult.pushed).toBe(true)
    expect(pushResult.branch).toBe('main')

    const status = await getProjectRepoSyncStatus({ projectDtag: 'proj-a', cloneUrl, branchName: 'main' })
    expect(status.ahead_count).toBe(0)
    expect(status.behind_count).toBe(0)
    expect(status.can_push).toBe(false) // nothing to push after a successful push
  })

  it('pulls new remote commits into the local clone', async () => {
    await cloneProjectRepository({ projectDtag: 'proj-a', cloneUrl })
    writeFileSync(path.join(remoteDir, 'file3.txt'), 'from remote\n')
    git(remoteDir, ['add', 'file3.txt'])
    git(remoteDir, ['commit', '--quiet', '-m', 'remote-side commit'])

    const result = await pullProjectLocalRepository({ projectDtag: 'proj-a', cloneUrl, branchName: 'main' })
    expect(result.pulled).toBe(true)

    const localPath = path.join(userDataDir, 'workstation-repos', 'proj-a')
    const log = git(localPath, ['log', '-1', '--format=%s'])
    expect(log.trim()).toBe('remote-side commit')
  })

  it('fails to push when there is no local clone yet', async () => {
    await expect(pushProjectLocalRepository({ projectDtag: 'never-cloned', cloneUrl })).rejects.toThrow(
      /clone the repository first/
    )
  })
})
