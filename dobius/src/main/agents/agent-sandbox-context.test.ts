import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ userDataRoot: '' }))
vi.mock('../storage/user-data-root', () => ({ getUserDataRoot: () => mocks.userDataRoot }))

import { resolveAgentRunSandboxPolicy, setAgentSandboxEnabledReader } from './agent-sandbox-context'

let home: string
let originalPath: string | undefined

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function resolve(overrides: { cwd?: string; claudeExecutable?: string } = {}) {
  return resolveAgentRunSandboxPolicy({
    agentId: 'atlas',
    cwd: overrides.cwd ?? path.join(home, 'work'),
    claudeExecutable: overrides.claudeExecutable
  })
}

beforeEach(() => {
  home = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'dobius-sbx-ctx-')))
  vi.spyOn(os, 'homedir').mockReturnValue(home)
  mocks.userDataRoot = path.join(home, 'user-data')
  mkdirSync(path.join(home, 'work'), { recursive: true })
  originalPath = process.env.PATH
})

afterEach(() => {
  setAgentSandboxEnabledReader(() => true)
  process.env.PATH = originalPath
  vi.restoreAllMocks()
  rmSync(home, { recursive: true, force: true })
})

describe('resolveAgentRunSandboxPolicy', () => {
  it('lists other agents and every other ~/.dobius entry from disk', () => {
    for (const id of ['atlas', 'nova', '_crew']) {
      mkdirSync(path.join(home, '.dobius', 'agents', id), { recursive: true })
    }
    mkdirSync(path.join(home, '.dobius', 'agent-hooks'), { recursive: true })
    writeFileSync(path.join(home, '.dobius', 'agents-config.json'), '{}')
    const denyWrite = resolve().sandbox?.filesystem?.denyWrite ?? []
    const dobius = path.join(home, '.dobius')
    expect(denyWrite).toEqual(
      expect.arrayContaining([
        path.join(dobius, 'agents', 'nova'),
        path.join(dobius, 'agents', '_crew'),
        path.join(dobius, 'agent-hooks'),
        path.join(dobius, 'agents-config.json')
      ])
    )
    expect(denyWrite).not.toContain(path.join(dobius, 'agents'))
    expect(denyWrite).not.toContain(path.join(dobius, 'agents', 'atlas'))
  })

  it('treats a missing agents or Dobius folder as empty', () => {
    const { sandbox } = resolve()
    expect(sandbox?.filesystem?.denyRead).toContain(path.join(home, '.dobius', 'agents'))
  })

  it('fails closed when the agents folder cannot be listed', () => {
    mkdirSync(path.join(home, '.dobius'), { recursive: true })
    writeFileSync(path.join(home, '.dobius', 'agents'), 'not a folder')
    expect(() => resolve()).toThrow(/cannot list the agents folder/)
  })

  it("grants a linked worktree its repo's git common dir", () => {
    const repo = path.join(home, 'repo')
    mkdirSync(repo)
    git(repo, 'init', '-q', '-b', 'main')
    git(repo, '-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-q', '--allow-empty', '-m', 'i')
    const worktree = path.join(home, 'repo-wt')
    git(repo, 'worktree', 'add', '-q', worktree, '-b', 'feature')
    const allowWrite = resolve({ cwd: worktree }).sandbox?.filesystem?.allowWrite ?? []
    expect(allowWrite).toEqual(expect.arrayContaining([worktree, path.join(repo, '.git')]))
    expect(allowWrite).not.toContain(home)
  })

  it('grants the temp roots', () => {
    const allowWrite = resolve().sandbox?.filesystem?.allowWrite ?? []
    expect(allowWrite).toContain(os.tmpdir())
    if (process.platform === 'darwin') {
      expect(allowWrite).toEqual(
        expect.arrayContaining(['/tmp', '/private/tmp', '/private/var/folders'])
      )
    }
  })

  it('protects PATH folders and the Claude CLI install, but never the run folders', () => {
    const install = path.join(home, '.hermes', 'node', 'lib', 'node_modules', 'claude-code')
    mkdirSync(path.join(install, 'bin'), { recursive: true })
    writeFileSync(path.join(install, 'package.json'), '{}')
    writeFileSync(path.join(install, 'bin', 'claude.exe'), '')
    const launcherDir = path.join(home, '.local', 'bin')
    mkdirSync(launcherDir, { recursive: true })
    symlinkSync(path.join(install, 'bin', 'claude.exe'), path.join(launcherDir, 'claude'))
    const cwd = path.join(home, 'work')
    process.env.PATH = [
      path.join(home, 'homebrew', 'bin'),
      path.join(cwd, 'node_modules', '.bin'),
      home,
      'relative/bin'
    ].join(path.delimiter)
    const denyWrite =
      resolve({ cwd, claudeExecutable: path.join(launcherDir, 'claude') }).sandbox?.filesystem
        ?.denyWrite ?? []
    expect(denyWrite).toEqual(
      expect.arrayContaining([install, launcherDir, path.join(home, 'homebrew', 'bin')])
    )
    expect(denyWrite).not.toContain(path.join(cwd, 'node_modules', '.bin'))
    expect(denyWrite).not.toContain(home)
    expect(denyWrite).not.toContain('relative/bin')
  })

  it('the Settings switch on (the default) keeps the kernel sandbox', () => {
    expect(resolve().sandbox).toMatchObject({ enabled: true, allowUnsandboxedCommands: false })
  })

  it('the Settings switch off drops only the kernel sandbox, keeps every deny rule, and warns', () => {
    mkdirSync(path.join(home, '.dobius', 'agents', 'nova'), { recursive: true })
    mkdirSync(path.join(home, '.dobius', 'agent-hooks'), { recursive: true })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const sandboxed = resolve()
    setAgentSandboxEnabledReader(() => false)
    const unsandboxed = resolve()
    expect(unsandboxed.sandbox).toBeUndefined()
    expect(unsandboxed.disallowedTools).toEqual(sandboxed.disallowedTools)
    expect(unsandboxed.disallowedTools).toEqual(
      expect.arrayContaining([
        'Edit(~/.dobius/agent-hooks/**)',
        'Edit(~/.zshrc)',
        'Edit(~/**/.claude/settings*.json)',
        'Read(~/.dobius/agents/nova/**)',
        'Bash(security find-generic-password:*)'
      ])
    )
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/Agent sandbox is OFF/)
  })
})
