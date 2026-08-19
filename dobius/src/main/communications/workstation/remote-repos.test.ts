import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userDataDir: string

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir }
}))

const { getProjectRepoSnapshot, getProjectRepoDiff, createProjectRemoteBranch, deleteProjectRemoteBranch } =
  await import('./remote-repos')

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
}

describe('remote-repos', () => {
  let workDir: string
  let remoteDir: string
  let headCommit: string

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), 'dobius-workstation-remote-'))
    userDataDir = path.join(workDir, 'userData')
    mkdirSync(userDataDir, { recursive: true })
    remoteDir = path.join(workDir, 'remote.git')
    mkdirSync(remoteDir)
    git(remoteDir, ['init', '--quiet', '-b', 'main'])
    git(remoteDir, ['config', 'user.email', 'fixture@example.com'])
    git(remoteDir, ['config', 'user.name', 'Fixture'])
    writeFileSync(path.join(remoteDir, 'README.md'), '# fixture\n')
    git(remoteDir, ['add', 'README.md'])
    git(remoteDir, ['commit', '--quiet', '-m', 'initial commit'])
    headCommit = git(remoteDir, ['rev-parse', 'HEAD']).trim()
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  it('builds a snapshot directly from a clone URL, with no persisted clone required', async () => {
    const snapshot = await getProjectRepoSnapshot({ cloneUrl: remoteDir, defaultBranch: 'main' })
    expect(snapshot.latest_commit?.hash).toBe(headCommit)
    expect(snapshot.files.map((f) => f.path)).toContain('README.md')
  })

  it('builds a diff between two branches from a clone URL', async () => {
    git(remoteDir, ['checkout', '-b', 'feature'])
    writeFileSync(path.join(remoteDir, 'feature.txt'), 'new file\n')
    git(remoteDir, ['add', 'feature.txt'])
    git(remoteDir, ['commit', '--quiet', '-m', 'feature commit'])

    const diff = await getProjectRepoDiff({ cloneUrl: remoteDir, baseBranch: 'main', targetRef: 'feature' })
    expect(diff.files.map((f) => f.path)).toContain('feature.txt')
    expect(diff.additions).toBeGreaterThan(0)
  })

  it('creates a remote branch when expectedCommit matches, and rejects when it does not', async () => {
    const created = await createProjectRemoteBranch({
      cloneUrl: remoteDir,
      sourceBranch: 'main',
      expectedCommit: headCommit,
      newBranch: 'new-feature'
    })
    expect(created.branch).toBe('new-feature')
    const branches = git(remoteDir, ['branch', '--format=%(refname:short)'])
    expect(branches).toContain('new-feature')

    await expect(
      createProjectRemoteBranch({
        cloneUrl: remoteDir,
        sourceBranch: 'main',
        expectedCommit: '0'.repeat(40),
        newBranch: 'should-not-be-created'
      })
    ).rejects.toThrow(/has moved/)
  })

  it('deletes a remote branch when expectedCommit matches, and rejects when it does not', async () => {
    git(remoteDir, ['branch', 'to-delete'])

    await expect(
      deleteProjectRemoteBranch({ cloneUrl: remoteDir, branch: 'to-delete', expectedCommit: '0'.repeat(40) })
    ).rejects.toThrow(/has moved/)

    const result = await deleteProjectRemoteBranch({ cloneUrl: remoteDir, branch: 'to-delete', expectedCommit: headCommit })
    expect(result.branch).toBe('to-delete')
    const branches = git(remoteDir, ['branch', '--format=%(refname:short)'])
    expect(branches).not.toContain('to-delete')
  })

  it('rejects an argv-flag-smuggled branch name instead of passing it to git', async () => {
    await expect(
      createProjectRemoteBranch({
        cloneUrl: remoteDir,
        sourceBranch: 'main',
        expectedCommit: headCommit,
        newBranch: '--upload-pack=touch /tmp/pwned'
      })
    ).rejects.toThrow(/must not start with/)
  })
})
