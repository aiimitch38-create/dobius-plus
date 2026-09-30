import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../storage/user-data-root', () => ({
  getUserDataRoot: () => '/fake/user-data'
}))

import {
  assertMobileWriteAllowed,
  foldApfsName,
  isProtectedMobileWritePath,
  mobileWriteDataRoots
} from './mobile-write-path-guard'

let base: string
let worktree: string
let dataRoot: string

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'dobius-mobile-guard-')))
  // Why: Carson's real worktrees live under <repo>/.claude/worktrees/.
  worktree = join(base, 'repo', '.claude', 'worktrees', 'wt')
  mkdirSync(join(worktree, 'docs'), { recursive: true })
  dataRoot = join(base, 'user-data')
  mkdirSync(dataRoot, { recursive: true })
})

const inWorktree = (relativePath: string, allowOutsideWorktree = false): Promise<void> =>
  assertMobileWriteAllowed({
    worktreeRoot: worktree,
    targetPath: join(worktree, relativePath),
    allowOutsideWorktree,
    dataRoots: [dataRoot]
  })

describe('mobile write path guard (BUILD-034)', () => {
  it('saves a normal markdown file in a worktree that lives under .claude/worktrees/', async () => {
    writeFileSync(join(worktree, 'docs', 'notes.md'), 'x')
    await expect(inWorktree('docs/notes.md')).resolves.toBeUndefined()
    await expect(inWorktree('docs/new-dir/new.md')).resolves.toBeUndefined()
  })

  it.each([
    'CLAUDE.md',
    'claude.md',
    'AGENTS.md',
    'AGENTſ.md',
    'AGENTS.override.md',
    'pkg/GEMINI.md',
    '.dobiuſ/notes.md',
    '.claude/commands/x.md',
    '.codex/config.toml',
    '.git/hooks/pre-commit',
    '.husky/pre-push',
    '.mcp.json',
    '.vscode/tasks.json',
    '.vscode/settings.json',
    '.github/copilot-instructions.md',
    'package.json',
    'packages/app/pacKage.json',
    'dobius.yaml',
    '.envrc',
    '.github/instructions/review.instructions.md',
    '.github/prompts/fix.prompt.md',
    '.clinerules/rules.md',
    '.kiro/steering/x.md',
    '.continue/config.yaml',
    '.windsurf/rules/x.md',
    '.opencode/agent.md',
    '.factory/droids/x.md',
    '.roo/rules/x.md',
    '.amazonq/rules/x.md',
    '.goosehints',
    '.vscode/launch.json',
    'docs/.hidden/notes.md',
    'CRUSH.md',
    'QWEN.md',
    'CONVENTIONS.md'
  ])('refuses %s', async (relativePath) => {
    await expect(inWorktree(relativePath)).rejects.toThrow(/mobile write refused/)
  })

  it('folds names the way APFS does', () => {
    expect(foldApfsName('AGENTſ.md')).toBe('agents.md')
    expect(foldApfsName('Key')).toBe('key')
    expect(isProtectedMobileWritePath('docs/tasks.json')).toBe(false)
    expect(isProtectedMobileWritePath('docs/guide.md')).toBe(false)
    expect(isProtectedMobileWritePath('README.md')).toBe(false)
  })

  it('refuses a file symlink even when it points at an unprotected file', async () => {
    writeFileSync(join(worktree, 'docs', 'real.md'), 'x')
    symlinkSync(join(worktree, 'docs', 'real.md'), join(worktree, 'docs', 'link.md'))
    await expect(inWorktree('docs/link.md')).rejects.toThrow(/symlink/)
  })

  it('refuses a write through a symlinked directory that redirects inside the worktree', async () => {
    mkdirSync(join(worktree, '.claude'), { recursive: true })
    symlinkSync(join(worktree, '.claude'), join(worktree, 'notes'))
    await expect(inWorktree('notes/x.md')).rejects.toThrow(/resolves somewhere else/)
  })

  it('refuses a write through a symlinked directory that escapes the worktree', async () => {
    mkdirSync(join(base, 'elsewhere'), { recursive: true })
    symlinkSync(join(base, 'elsewhere'), join(worktree, 'out'))
    await expect(inWorktree('out/x.md')).rejects.toThrow(/resolves somewhere else/)
    await expect(inWorktree('out/x.md', true)).rejects.toThrow(/resolves somewhere else/)
  })

  it('refuses writes outside the worktree unless allowed, and protected ones always', async () => {
    const outside = join(base, 'scratch', 'notes.txt')
    mkdirSync(join(base, 'scratch'), { recursive: true })
    const check = (targetPath: string, allowOutsideWorktree: boolean): Promise<void> =>
      assertMobileWriteAllowed({
        worktreeRoot: worktree,
        targetPath,
        allowOutsideWorktree,
        dataRoots: [dataRoot]
      })
    await expect(check(outside, false)).rejects.toThrow(/outside the worktree/)
    await expect(check(outside, true)).resolves.toBeUndefined()
    await expect(check(join(base, 'home', '.claude', 'settings.json'), true)).rejects.toThrow(
      /mobile write refused/
    )
  })

  it("refuses any path inside Dobius's own data, including through a symlink", async () => {
    const check = (targetPath: string): Promise<void> =>
      assertMobileWriteAllowed({
        worktreeRoot: worktree,
        targetPath,
        allowOutsideWorktree: true,
        dataRoots: [dataRoot]
      })
    await expect(check(join(dataRoot, 'dobius-devices.json'))).rejects.toThrow(/Dobius data/)
    await expect(check(join(dataRoot, 'nested', 'x.txt'))).rejects.toThrow(/Dobius data/)
    symlinkSync(dataRoot, join(base, 'data-link'))
    await expect(check(join(base, 'data-link', 'dobius-devices.json'))).rejects.toThrow(
      /Dobius data/
    )
  })

  it('includes the userData root and ~/.dobius as Dobius data', () => {
    expect(mobileWriteDataRoots()).toEqual(['/fake/user-data', join(homedir(), '.dobius')])
  })

  it('refuses SSH writes until the remote filesystem can be verified', async () => {
    const remote = (targetPath: string, allowOutsideWorktree = false): Promise<void> =>
      assertMobileWriteAllowed({
        worktreeRoot: '/srv/repo/.claude/worktrees/wt',
        targetPath,
        connectionId: 'ssh-1',
        allowOutsideWorktree
      })
    await expect(remote('/srv/repo/.claude/worktrees/wt/docs/a.md')).rejects.toThrow(
      /SSH writes require remote path verification/
    )
    await expect(remote('/srv/repo/.claude/worktrees/wt/AGENTſ.md')).rejects.toThrow(
      /mobile write refused/
    )
    await expect(remote('/srv/elsewhere/a.md')).rejects.toThrow(/mobile write refused/)
  })
})
