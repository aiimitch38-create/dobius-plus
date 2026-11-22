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
  it('lets the agent read only its own card screenshot folder', async () => {
    const createManagedWorktree = vi.fn(async () => ({
      worktree: { id: 'repo::/w/x', path: '/w/x', branch: 'x' }
    }))
    const deps = wire({ createManagedWorktree })
    const base = { repoId: 'repo', name: 'autofix-x-1', prompt: 'p', comment: 'c', taskId: 'task-1' }
    await deps.createWorktree({ ...base, hasAttachments: true })
    const withShots = (createManagedWorktree.mock.calls[0] as unknown as [{ startup: { command: string } }])[0]
    expect(withShots.startup.command).toMatch(/'--add-dir' '[^']*vertex-attachments\/task-1'/)
    await deps.createWorktree({ ...base, hasAttachments: false })
    const without = (createManagedWorktree.mock.calls[1] as unknown as [{ startup: { command: string } }])[0]
    expect(without.startup.command).not.toContain('--add-dir')
  })
})
