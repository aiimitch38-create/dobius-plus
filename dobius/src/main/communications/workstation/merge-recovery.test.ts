import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userDataDir: string
const openNativeTerminalAtMock = vi.fn().mockResolvedValue(undefined)

vi.mock('electron', () => ({ app: { getPath: () => userDataDir } }))
vi.mock('./terminal-launch', () => ({ openNativeTerminalAt: (...args: unknown[]) => openNativeTerminalAtMock(...args) }))

const { openProjectTerminal, openProjectMergeRecoveryTerminal } = await import('./merge-recovery')

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
}

function initFixtureRepo(dir: string): string {
  git(dir, ['init', '--quiet', '-b', 'main'])
  git(dir, ['config', 'user.email', 'fixture@example.com'])
  git(dir, ['config', 'user.name', 'Fixture'])
  writeFileSync(path.join(dir, 'README.md'), '# fixture\n')
  git(dir, ['add', 'README.md'])
  git(dir, ['commit', '--quiet', '-m', 'initial commit'])
  return git(dir, ['rev-parse', 'HEAD']).trim()
}

describe('openProjectTerminal', () => {
  let workDir: string
  let remoteDir: string

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), 'dobius-workstation-terminal-open-'))
    userDataDir = path.join(workDir, 'userData')
    mkdirSync(userDataDir, { recursive: true })
    remoteDir = path.join(workDir, 'remote.git')
    mkdirSync(remoteDir)
    initFixtureRepo(remoteDir)
    openNativeTerminalAtMock.mockClear()
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  it('clones then opens a terminal when no local clone exists yet', async () => {
    const result = await openProjectTerminal({ projectDtag: 'proj-a', cloneUrl: remoteDir })
    expect(result.cloned).toBe(true)
    expect(openNativeTerminalAtMock).toHaveBeenCalledWith(result.path)
  })

  it('fails without cloning or opening anything when there is no clone and no cloneUrl', async () => {
    await expect(openProjectTerminal({ projectDtag: 'never-cloned' })).rejects.toThrow(/No local clone/)
    expect(openNativeTerminalAtMock).not.toHaveBeenCalled()
  })
})

describe('openProjectMergeRecoveryTerminal', () => {
  let workDir: string
  let targetRemote: string
  let sourceRemote: string
  let targetHead: string

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), 'dobius-workstation-merge-recovery-'))
    userDataDir = path.join(workDir, 'userData')
    mkdirSync(userDataDir, { recursive: true })
    targetRemote = path.join(workDir, 'target.git')
    mkdirSync(targetRemote)
    initFixtureRepo(targetRemote)

    sourceRemote = path.join(workDir, 'source.git')
    execFileSync('git', ['clone', '--quiet', targetRemote, sourceRemote])
    git(sourceRemote, ['config', 'user.email', 'fixture@example.com'])
    git(sourceRemote, ['config', 'user.name', 'Fixture'])
    writeFileSync(path.join(sourceRemote, 'README.md'), '# fixture\nconflicting change\n')
    git(sourceRemote, ['commit', '-a', '--quiet', '-m', 'conflicting source change'])

    writeFileSync(path.join(targetRemote, 'README.md'), '# fixture\ntarget-side change\n')
    git(targetRemote, ['commit', '-a', '--quiet', '-m', 'target-side change'])
    // Why: expectedCommit must match what the function actually fetches (the
    // CURRENT target head, after this setup's own commit) — not the head
    // captured before this beforeEach made further commits.
    targetHead = git(targetRemote, ['rev-parse', 'HEAD']).trim()

    openNativeTerminalAtMock.mockClear()
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  it('prepares a conflicted merge for manual recovery and opens a terminal there', async () => {
    const result = await openProjectMergeRecoveryTerminal({
      projectDtag: 'proj-a',
      targetCloneUrl: targetRemote,
      sourceCloneUrl: sourceRemote,
      targetBranch: 'main',
      sourceBranch: 'main',
      expectedCommit: targetHead
    })
    expect(result.recoveryRef).toMatch(/^refs\/heads\/dobius\/merge-recovery\//)
    expect(openNativeTerminalAtMock).toHaveBeenCalledWith(result.path)
    const status = git(result.path, ['status', '--porcelain'])
    expect(status).toContain('README.md')
  })

  it('rejects when the target branch has moved past expectedCommit', async () => {
    await expect(
      openProjectMergeRecoveryTerminal({
        projectDtag: 'proj-b',
        targetCloneUrl: targetRemote,
        sourceCloneUrl: sourceRemote,
        targetBranch: 'main',
        sourceBranch: 'main',
        expectedCommit: '0'.repeat(40)
      })
    ).rejects.toThrow(/has moved/)
  })
})
