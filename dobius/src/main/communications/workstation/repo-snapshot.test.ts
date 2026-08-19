import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildRepoDiff, buildRepoSnapshot, readCommitLog } from './repo-snapshot'

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
}

describe('repo-snapshot', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'dobius-workstation-snapshot-'))
    git(dir, ['init', '--quiet', '-b', 'main'])
    git(dir, ['config', 'user.email', 'a@example.com'])
    git(dir, ['config', 'user.name', 'Author One'])
    writeFileSync(path.join(dir, 'a.txt'), 'first\n')
    git(dir, ['add', 'a.txt'])
    git(dir, ['commit', '--quiet', '-m', 'first commit'])
    git(dir, ['config', 'user.email', 'b@example.com'])
    git(dir, ['config', 'user.name', 'Author Two'])
    writeFileSync(path.join(dir, 'a.txt'), 'first\nsecond\n')
    git(dir, ['commit', '-a', '--quiet', '-m', 'second commit'])
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns an empty array for an unborn HEAD instead of throwing', async () => {
    const emptyDir = mkdtempSync(path.join(tmpdir(), 'dobius-workstation-empty-'))
    git(emptyDir, ['init', '--quiet'])
    expect(await readCommitLog(emptyDir, 'HEAD')).toEqual([])
    rmSync(emptyDir, { recursive: true, force: true })
  })

  it('reads real commits newest-first with correctly parsed fields', async () => {
    const commits = await readCommitLog(dir, 'HEAD')
    expect(commits).toHaveLength(2)
    expect(commits[0]?.subject).toBe('second commit')
    expect(commits[0]?.author_name).toBe('Author Two')
    expect(commits[1]?.subject).toBe('first commit')
    expect(commits.every((c) => /^[0-9a-f]{40}$/.test(c.hash))).toBe(true)
  })

  it('builds a snapshot with commits, files, and a contributor rollup from real history', async () => {
    const snapshot = await buildRepoSnapshot(dir, 'HEAD')
    expect(snapshot.latest_commit?.subject).toBe('second commit')
    expect(snapshot.files.map((f) => f.path)).toEqual(['a.txt'])
    expect(snapshot.contributors).toHaveLength(2)
    expect(snapshot.contributors.map((c) => c.email).sort()).toEqual(['a@example.com', 'b@example.com'])
  })

  it('builds a real diff with additions/deletions and a per-file patch', async () => {
    const firstCommit = git(dir, ['log', '--format=%H']).trim().split('\n').at(-1) as string
    const diff = await buildRepoDiff(dir, firstCommit, 'HEAD', null)
    expect(diff.files).toHaveLength(1)
    expect(diff.files[0]?.path).toBe('a.txt')
    expect(diff.additions).toBeGreaterThan(0)
    expect(diff.files[0]?.patch).toContain('diff --git')
  })
})
