import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BugAutoFixDeps } from './bug-autofix'

const { configureBugAutoFix } = vi.hoisted(() => ({ configureBugAutoFix: vi.fn() }))
vi.mock('./bug-autofix', () => ({ configureBugAutoFix, disposeBugAutoFix: vi.fn() }))
vi.mock('./vertex-task-store', () => ({ vertexTaskStore: { list: vi.fn(), update: vi.fn() } }))
vi.mock('../leads/lead-config', () => ({ readLeadConfig: vi.fn() }))
vi.mock('../storage/user-data-root', () => ({ getUserDataRoot: () => '/ud' }))
vi.mock('../agents/execution-gate', () => ({
  blockExecutionOrigin: vi.fn(),
  checkExecutionAdmission: vi.fn()
}))

import { wireBugAutoFix } from './bug-autofix-wiring'
import { setVertexAttachmentsRoot } from './vertex-attachment-paths'

function wire(runtime: Record<string, unknown>): BugAutoFixDeps {
  const store = { getSettings: () => ({}) }
  wireBugAutoFix(store as never, runtime as never)
  return configureBugAutoFix.mock.calls.at(-1)?.[0] as BugAutoFixDeps
}

beforeEach(() => configureBugAutoFix.mockClear())

describe('bug auto-fix wiring: liveness', () => {
  it('asks for fresh PTY liveness and counts a truncated list as running', async () => {
    const listTerminals = vi.fn(async () => ({ terminals: [], truncated: true, totalCount: 500 }))
    const deps = wire({ listTerminals, getTerminalAgentStatus: vi.fn() })
    await expect(deps.isWorktreeLive('repo::/wt')).resolves.toBe(true)
    expect(listTerminals).toHaveBeenCalledWith('id:repo::/wt', expect.any(Number), {
      requireFreshPtyLiveness: true
    })
  })

  it('is live only when a connected terminal runs an agent', async () => {
    const terminals = [{ handle: 'h1', connected: true }]
    const getTerminalAgentStatus = vi.fn(async () => ({ isRunningAgent: false }))
    const deps = wire({
      listTerminals: async () => ({ terminals, truncated: false, totalCount: 1 }),
      getTerminalAgentStatus
    })
    await expect(deps.isWorktreeLive('w')).resolves.toBe(false)
    getTerminalAgentStatus.mockResolvedValueOnce({ isRunningAgent: true })
    await expect(deps.isWorktreeLive('w')).resolves.toBe(true)
  })
})

describe('bug auto-fix wiring: interrupted-start lookup', () => {
  it('separates found, authoritative absence and unavailable', async () => {
    const listDetectedManagedWorktrees = vi.fn()
    const deps = wire({ listDetectedManagedWorktrees })
    listDetectedManagedWorktrees.mockResolvedValueOnce({
      authoritative: false,
      worktrees: [{ id: 'repo::/w/autofix-a-1', path: '/w/autofix-a-1', branch: 'autofix-a-1' }]
    })
    await expect(deps.findWorktree('repo', 'autofix-a-1')).resolves.toMatchObject({
      worktreeId: 'repo::/w/autofix-a-1'
    })
    listDetectedManagedWorktrees.mockResolvedValueOnce({ authoritative: true, worktrees: [] })
    await expect(deps.findWorktree('repo', 'autofix-a-1')).resolves.toBeNull()
    // A git scan that timed out falls back to metadata: not proof of absence.
    listDetectedManagedWorktrees.mockResolvedValueOnce({ authoritative: false, worktrees: [] })
    await expect(deps.findWorktree('repo', 'autofix-a-1')).resolves.toBe('unknown')
    listDetectedManagedWorktrees.mockRejectedValueOnce(new Error('runtime_unavailable'))
    await expect(deps.findWorktree('repo', 'autofix-a-1')).resolves.toBe('unknown')
  })
})

describe('bug auto-fix wiring: launch', () => {
  it('copies the screenshots into the workspace and gives no outside folder', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autofix-evidence-'))
    try {
      const shots = join(root, 'ud', 'vertex-attachments', 'task-1')
      mkdirSync(shots, { recursive: true })
      writeFileSync(join(shots, 'a1.png'), 'png')
      const outside = join(root, 'secret.txt')
      writeFileSync(outside, 'nope')
      setVertexAttachmentsRoot(join(root, 'ud', 'vertex-attachments'))
      const worktree = join(root, 'w', 'autofix-x-1')
      mkdirSync(worktree, { recursive: true })
      const createManagedWorktree = vi.fn(
        async (args: { prepareWorkspace?: (path: string) => void }) => {
          await args.prepareWorkspace?.(worktree)
          return { worktree: { id: 'repo::w', path: worktree, branch: 'x' } }
        }
      )
      const deps = wire({ createManagedWorktree })
      await deps.createWorktree({
        repoId: 'repo',
        name: 'autofix-x-1',
        prompt: 'p',
        comment: 'c',
        screenshots: [join(shots, 'a1.png'), outside]
      })
      const call = createManagedWorktree.mock.calls[0][0] as unknown as {
        startup: { command: string }
      }
      expect(call.startup.command).not.toContain('--add-dir')
      const evidence = join(worktree, '.dobius', 'bug-report')
      expect(readFileSync(join(evidence, 'a1.png'), 'utf8')).toBe('png')
      expect(readFileSync(join(evidence, '.gitignore'), 'utf8')).toBe('*\n')
      expect(existsSync(join(evidence, 'secret.txt'))).toBe(false)
    } finally {
      setVertexAttachmentsRoot(null)
      rmSync(root, { recursive: true, force: true })
    }
  })
})
