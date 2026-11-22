import { describe, expect, it, vi } from 'vitest'

import type { VertexTask, VertexTaskPatch } from '../../shared/vertex-task-types'
import { buildBugFixPrompt, createBugAutoFix, type BugAutoFixDeps } from './bug-autofix'

function card(id: string, overrides: Partial<VertexTask> = {}): VertexTask {
  return {
    id,
    title: `Bug ${id}`,
    description: 'The button does nothing',
    status: 'todo',
    priority: 'high',
    type: 'bug',
    destination: 'system',
    order: 0,
    collaborators: [],
    labels: ['bug', 'from-app'],
    related: [],
    dependencies: [],
    childTaskIds: [],
    subtasks: [],
    files: [],
    projectId: 'dobius-plus',
    assignee: { kind: 'hermes-profile', id: 'lead-dobius-plus', name: 'Dobius lead', initials: 'DL' },
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

type Harness = {
  tasks: VertexTask[]
  deps: BugAutoFixDeps
  createWorktree: ReturnType<typeof vi.fn>
  settle: Array<() => void>
  flags: { enabled: boolean; paused: boolean }
}

function harness(): Harness {
  const tasks: VertexTask[] = []
  const settle: Array<() => void> = []
  const flags = { enabled: true, paused: false }
  let clock = 1000
  const createWorktree = vi.fn(
    () =>
      new Promise<{ worktreeId: string; branch: string }>((resolve) => {
        const n = settle.length + 1
        settle.push(() => resolve({ worktreeId: `repo::/wt/${n}`, branch: `fix-${n}` }))
      })
  )
  const deps: BugAutoFixDeps = {
    listTasks: () => tasks.map((t) => ({ ...t })),
    updateTask: (taskId: string, patch: VertexTaskPatch) => {
      const task = tasks.find((t) => t.id === taskId)
      if (!task) {
        return null
      }
      Object.assign(task, patch)
      return { ...task }
    },
    isEnabled: () => flags.enabled,
    admission: () =>
      flags.paused
        ? { allowed: false, reason: 'paused', message: 'Crew is paused.' }
        : { allowed: true },
    findRepos: (projectId) =>
      projectId === 'dobius-plus' ? [{ id: 'repo', name: 'dobius-plus', path: '/r/dobius-plus' }] : [],
    createWorktree,
    agentName: () => 'claude',
    now: () => ++clock,
    log: () => undefined
  }
  return { tasks, deps, createWorktree, settle, flags }
}

/** Simulates vertexTasks:create: the store row exists, then the hook fires. */
function report(h: Harness, autoFix: ReturnType<typeof createBugAutoFix>, task: VertexTask): boolean {
  h.tasks.push(task)
  return autoFix.queue({ ...task })
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('bug auto-fix', () => {
  it('a bug card triggers exactly one dispatch', async () => {
    const h = harness()
    const autoFix = createBugAutoFix(h.deps)
    expect(report(h, autoFix, card('a'))).toBe(true)
    const pending = autoFix.pump()
    h.settle[0]()
    await pending
    expect(h.createWorktree).toHaveBeenCalledTimes(1)
    const [request] = h.createWorktree.mock.calls[0]
    expect(request.repoId).toBe('repo')
    expect(request.name).toBe('fix-bug-a')
    expect(request.prompt).toContain('The button does nothing')
    const stored = h.tasks[0]
    expect(stored.status).toBe('in-progress')
    expect(stored.autoFix).toMatchObject({
      status: 'dispatched',
      worktreeId: 'repo::/wt/1',
      branch: 'fix-1',
      agent: 'claude'
    })
  })

  it('a second event, a restart or another pump for the same card does not dispatch again', async () => {
    const h = harness()
    const autoFix = createBugAutoFix(h.deps)
    report(h, autoFix, card('a'))
    const first = autoFix.pump()
    h.settle[0]()
    await first
    // Duplicate create event carrying the stored row (now marked).
    expect(autoFix.queue({ ...h.tasks[0] })).toBe(false)
    // Fresh instance = app restart; the mark lives on the card.
    const restarted = createBugAutoFix(h.deps)
    restarted.recoverInterrupted()
    expect(restarted.queue({ ...h.tasks[0] })).toBe(false)
    // Even after the card leaves In Progress and returns to To Do.
    h.tasks[0].status = 'todo'
    await restarted.pump()
    await autoFix.pump()
    expect(h.createWorktree).toHaveBeenCalledTimes(1)
  })

  it('a non-bug card does not dispatch', async () => {
    const h = harness()
    const autoFix = createBugAutoFix(h.deps)
    expect(report(h, autoFix, card('f', { type: 'feature', labels: ['change-request'] }))).toBe(false)
    await autoFix.pump()
    expect(h.createWorktree).not.toHaveBeenCalled()
    expect(h.tasks[0].autoFix).toBeUndefined()
  })

  it('agent-made bug cards and cards owned by board auto-dispatch do not dispatch', async () => {
    const h = harness()
    const autoFix = createBugAutoFix(h.deps)
    expect(
      report(h, autoFix, card('child', { origin: { kind: 'agent', name: 'fixer', createdAt: 1 } }))
    ).toBe(false)
    expect(
      report(h, autoFix, card('agent', { assignee: { kind: 'agent', id: 'x', name: 'X', initials: 'X' } }))
    ).toBe(false)
    await autoFix.pump()
    expect(h.createWorktree).not.toHaveBeenCalled()
  })

  it('paused crew does not dispatch; the card stays queued and starts after resume', async () => {
    const h = harness()
    h.flags.paused = true
    const autoFix = createBugAutoFix(h.deps)
    report(h, autoFix, card('a'))
    await autoFix.pump()
    expect(h.createWorktree).not.toHaveBeenCalled()
    expect(h.tasks[0].autoFix?.status).toBe('queued')
    expect(h.tasks[0].status).toBe('todo')
    h.flags.paused = false
    const resumed = autoFix.pump()
    h.settle[0]()
    await resumed
    expect(h.createWorktree).toHaveBeenCalledTimes(1)
  })

  it('a third concurrent bug waits until a slot frees', async () => {
    const h = harness()
    const autoFix = createBugAutoFix(h.deps)
    report(h, autoFix, card('a'))
    report(h, autoFix, card('b'))
    report(h, autoFix, card('c'))
    const first = autoFix.pump()
    await flush()
    expect(h.createWorktree).toHaveBeenCalledTimes(2)
    // A pump while both are still being created must not start the third.
    await autoFix.pump()
    expect(h.createWorktree).toHaveBeenCalledTimes(2)
    h.settle[0]()
    h.settle[1]()
    await first
    await autoFix.pump()
    expect(h.createWorktree).toHaveBeenCalledTimes(2)
    expect(h.tasks[2].autoFix?.status).toBe('queued')
    // Carson moves the first fix to Review: its slot frees.
    h.tasks[0].status = 'review'
    const next = autoFix.pump()
    await flush()
    expect(h.createWorktree).toHaveBeenCalledTimes(3)
    h.settle[2]()
    await next
    expect(h.tasks[2].autoFix?.status).toBe('dispatched')
  })

  it('setting off does not queue or dispatch', async () => {
    const h = harness()
    h.flags.enabled = false
    const autoFix = createBugAutoFix(h.deps)
    expect(report(h, autoFix, card('a'))).toBe(false)
    await autoFix.pump()
    expect(h.createWorktree).not.toHaveBeenCalled()
    expect(h.tasks[0].autoFix).toBeUndefined()
  })

  it('setting off also holds cards that were already queued', async () => {
    const h = harness()
    const autoFix = createBugAutoFix(h.deps)
    report(h, autoFix, card('a'))
    h.flags.enabled = false
    await autoFix.pump()
    expect(h.createWorktree).not.toHaveBeenCalled()
  })

  it('a failed start goes back to To Do, is marked failed and is never retried', async () => {
    const h = harness()
    h.createWorktree.mockImplementationOnce(() => Promise.reject(new Error('git said no')))
    const autoFix = createBugAutoFix(h.deps)
    report(h, autoFix, card('a'))
    await autoFix.pump()
    expect(h.tasks[0]).toMatchObject({ status: 'todo', autoFix: { status: 'failed', reason: 'git said no' } })
    await autoFix.pump()
    expect(h.createWorktree).toHaveBeenCalledTimes(1)
  })

  it('a card picked up while it waited is skipped, not started', async () => {
    const h = harness()
    const autoFix = createBugAutoFix(h.deps)
    report(h, autoFix, card('a'))
    h.tasks[0].status = 'in-progress'
    await autoFix.pump()
    expect(h.createWorktree).not.toHaveBeenCalled()
    expect(h.tasks[0].autoFix?.status).toBe('skipped')
  })

  it('no matching repo marks the card failed without starting anything', async () => {
    const h = harness()
    const autoFix = createBugAutoFix(h.deps)
    report(h, autoFix, card('a', { projectId: 'elsewhere' }))
    await autoFix.pump()
    expect(h.createWorktree).not.toHaveBeenCalled()
    expect(h.tasks[0].autoFix?.status).toBe('failed')
  })

  it('a start interrupted by a restart is ended as failed and frees its slot', () => {
    const h = harness()
    h.tasks.push(card('a', { status: 'in-progress', autoFix: { status: 'starting', queuedAt: 1, updatedAt: 1 } }))
    createBugAutoFix(h.deps).recoverInterrupted()
    expect(h.tasks[0].autoFix?.status).toBe('failed')
  })

  it('the prompt fences the report and states the never-install / never-push rules', () => {
    const prompt = buildBugFixPrompt(
      card('a', {
        attachments: [
          { id: 'i', name: 'shot.png', path: '/u/shot.png', mime: 'image/png', bytes: 1, createdAt: 1 }
        ]
      }),
      { id: 'repo', name: 'dobius-plus', path: '/r/dobius-plus' }
    )
    expect(prompt).toContain('<bug-report>')
    expect(prompt).toContain('Screenshot: /u/shot.png')
    expect(prompt).toContain('typecheck:node')
    expect(prompt).toContain('Never install anything')
    expect(prompt).toContain('Never push')
    expect(prompt).toContain('git commit')
  })
})
