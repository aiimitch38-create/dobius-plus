import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDobiusToolHandlers, type DobiusToolContext } from './dobius-tool-handlers'
import { buildDobiusToolServer } from './dobius-tool-server'
import { resolveAgentRunProfile } from '../agent-runner-dobius-tools'

const mocks = vi.hoisted(() => ({
  appendDraft: vi.fn(),
  appendBriefingItem: vi.fn(),
  fetch: vi.fn(),
  getAsanaConfig: vi.fn(),
  checkExecutionAdmission: vi.fn()
}))

// The real Asana dispatch ledger, in a throwaway userData dir.
const userDataDir = vi.hoisted(() => ({ path: '' }))
vi.mock('electron', () => ({ app: { getPath: () => userDataDir.path } }))

vi.mock('../execution-gate', () => ({
  checkExecutionAdmission: mocks.checkExecutionAdmission
}))

// Capture registrations instead of starting a real in-process MCP server.
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: (name: string, _description: string, _schema: unknown, handler: unknown) => ({
    name,
    handler
  }),
  createSdkMcpServer: (config: { tools: { name: string }[] }) => config
}))

vi.mock('../agent-runs-store', () => ({ appendAgentRunOutbox: vi.fn(() => true) }))

vi.stubGlobal('fetch', mocks.fetch)

vi.mock('../agent-draft-store', () => ({
  appendDraft: mocks.appendDraft
}))

vi.mock('../agent-briefing-store', () => ({
  appendBriefingItem: mocks.appendBriefingItem
}))

vi.mock('../../asana/asana-config', () => ({
  getAsanaConfig: mocks.getAsanaConfig
}))

vi.mock('../agents-store', () => ({
  listAgents: vi.fn(() => [
    {
      id: 'agent-1',
      name: 'Builder',
      description: 'Ships changes',
      model: 'claude-opus-4-8',
      heartbeat: { enabled: true },
      channels: { imessage: false },
      allowedTools: [],
      skills: [],
      cwd: '/secret/path',
      icon: 'bot',
      color: '#b9bcc2',
      systemPrompt: '',
      bypassPermissions: false,
      notify: 'digest + urgent',
      createdAt: 1,
      updatedAt: 1
    }
  ])
}))

vi.mock('../agent-runner', () => ({
  hasLiveAgentRun: vi.fn(() => false),
  listAgentRuns: vi.fn(() => [
    {
      id: 'run-1',
      agentId: 'agent-1',
      prompt: 'do work',
      startedAt: 2,
      status: 'success',
      summary: 'finished without token abc123'
    }
  ])
}))

vi.mock('../../ipc/knowledge-indexer', () => ({
  buildKnowledgeTree: vi.fn(() => ({
    hubLabel: 'Knowledge',
    hubSub: '',
    branches: [
      {
        id: 'projects',
        label: 'Projects',
        sub: '',
        groups: [],
        totalCount: 2,
        leaves: [
          {
            id: 'leaf-good',
            title: 'Runbook',
            summary: 'Deploy knowledge',
            filePath: '/repo/AGENTS.md',
            icon: 'book',
            addedAt: 1,
            links: []
          },
          {
            id: 'leaf-bad',
            title: 'Unsafe',
            summary: 'Outside root',
            filePath: '/tmp/private.md',
            icon: 'book',
            addedAt: 1,
            links: []
          }
        ]
      }
    ]
  })),
  isAllowedKnowledgePath: vi.fn((filePath: string) => filePath === '/repo/AGENTS.md'),
  safeReadFile: vi.fn((filePath: string) =>
    filePath === '/repo/AGENTS.md' ? 'Deploy by running the verified release checklist.' : null
  )
}))

userDataDir.path = mkdtempSync(path.join(tmpdir(), 'dobius-tool-server-'))

let gidCounter = 0
function freshGid(): string {
  gidCounter += 1
  return `gid-${gidCounter}`
}

// A build-lane Asana triage run: the only profile that may dispatch builds.
// Each test gets its own Asana task, since the ledger records one build per task.
function buildLaneContext(): DobiusToolContext {
  const profile = resolveAgentRunProfile({
    source: 'asana',
    asanaLane: 'build',
    asanaTaskGid: freshGid()
  })
  return {
    agentId: 'agent-1',
    runId: 'run-1',
    tools: profile.dobiusTools,
    buildLane: profile.buildLane,
    asanaTaskGid: profile.asanaTaskGid
  }
}
let context = buildLaneContext()

/** Another build-lane triage run for its own, new Asana task. */
function buildRun(runId: string): DobiusToolContext {
  return { ...context, runId, asanaTaskGid: freshGid() }
}

afterAll(() => {
  rmSync(userDataDir.path, { recursive: true, force: true })
})
const store = { getRepos: () => [{ path: '/repo' }] } as never

beforeEach(() => {
  context = buildLaneContext()
  mocks.appendDraft.mockReset()
  mocks.appendBriefingItem.mockReset()
  mocks.fetch.mockReset()
  mocks.getAsanaConfig.mockReset()
  mocks.checkExecutionAdmission.mockReset()
  mocks.checkExecutionAdmission.mockReturnValue({ allowed: true })
  mocks.appendDraft.mockReturnValue({ id: 'draft-1' })
  mocks.appendBriefingItem.mockReturnValue({ id: 'brief-1' })
  mocks.getAsanaConfig.mockReturnValue({
    autoMode: { enabled: true, intervalMinutes: 10, buildAgent: 'claude' }
  })
})

describe('Dobius tool handlers', () => {
  it('queues Asana comments as drafts without network calls', async () => {
    const handlers = createDobiusToolHandlers(context, store)
    const result = await handlers.asanaDraftComment({ gid: '120', body: 'Looks good' })
    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toContain('queued for human approval')
    expect(mocks.appendDraft).toHaveBeenCalledWith({
      agentId: 'agent-1',
      target: { kind: 'asana', gid: '120' },
      body: 'Looks good'
    })
    expect(mocks.appendBriefingItem).toHaveBeenCalledWith({
      agentId: 'agent-1',
      urgency: 'digest',
      summary: 'Draft Asana comment ready for 120'
    })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('reads matching knowledge and blocks unsafe leaves through the allow gate', async () => {
    const handlers = createDobiusToolHandlers(context, store)
    const match = await handlers.readKnowledge({ query: 'deploy' })
    expect(match.content[0].text).toContain('Runbook')
    expect(match.content[0].text).toContain('verified release checklist')
    const unsafe = await handlers.readKnowledge({ query: '', leafId: 'leaf-bad' })
    expect(unsafe.isError).toBe(true)
    expect(unsafe.content[0].text).toContain('allowed knowledge path')
  })

  it('files briefing items through the existing store', async () => {
    const handlers = createDobiusToolHandlers(context, store)
    const result = await handlers.fileBriefingItem({ urgency: 'now', summary: 'Needs review' })
    expect(result.content[0].text).toContain('filed')
    expect(mocks.appendBriefingItem).toHaveBeenCalledWith({
      agentId: 'agent-1',
      urgency: 'now',
      summary: 'Needs review'
    })
  })

  it('dispatches build work by repo id and explicit branch name', async () => {
    const { setBuildDispatcher, setRepoLister } = await import('../agent-dispatch-registry')
    const dispatch = vi.fn(async () => ({ worktreeId: 'wt-1', ok: true }))
    setRepoLister(() => [
      { id: 'repo-1', name: 'DobiusPlus' },
      { id: 'repo-2', name: 'Other' }
    ])
    setBuildDispatcher(dispatch)

    const handlers = createDobiusToolHandlers(context, store)
    const result = await handlers.dispatchBuild({
      repo: 'repo-1',
      brief: 'Implement the build lane dispatch.',
      branchName: 'asana-build-lane'
    })

    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toContain('wt-1')
    expect(dispatch).toHaveBeenCalledWith({
      repoId: 'repo-1',
      name: 'asana-build-lane',
      baseBranch: undefined,
      brief: 'Implement the build lane dispatch.',
      buildAgent: 'claude'
    })
    expect(mocks.appendBriefingItem).toHaveBeenCalledWith({
      agentId: 'agent-1',
      urgency: 'now',
      summary: 'Build dispatched: DobiusPlus / asana-build-lane'
    })
  })

  it('sanitizes a malicious branch name (no path traversal into the worktree name)', async () => {
    const { setBuildDispatcher, setRepoLister } = await import('../agent-dispatch-registry')
    const dispatch = vi.fn(async () => ({ worktreeId: 'wt-9', ok: true }))
    setRepoLister(() => [{ id: 'repo-1', name: 'DobiusPlus' }])
    setBuildDispatcher(dispatch)
    const handlers = createDobiusToolHandlers(context, store)
    await handlers.dispatchBuild({
      repo: 'repo-1',
      brief: 'do a thing',
      branchName: '../../evil; rm -rf /'
    })
    const passedName = (dispatch.mock.calls.at(0)?.at(0) as { name?: string } | undefined)?.name
    expect(passedName).toBeDefined()
    expect(passedName).not.toContain('/')
    expect(passedName).not.toContain('..')
    expect(passedName).toMatch(/^[a-z0-9-]+$/)
  })

  it('dispatches build work by case-insensitive repo name with a slugged name', async () => {
    const { setBuildDispatcher, setRepoLister } = await import('../agent-dispatch-registry')
    const dispatch = vi.fn(async () => ({ worktreeId: 'wt-2', ok: true }))
    setRepoLister(() => [{ id: 'repo-1', name: 'DobiusPlus' }])
    setBuildDispatcher(dispatch)

    const handlers = createDobiusToolHandlers(context, store)
    await handlers.dispatchBuild({
      repo: 'dobiusplus',
      brief: 'Fix flaky build dispatch from Asana lane quickly please'
    })

    expect(dispatch).toHaveBeenCalledWith({
      repoId: 'repo-1',
      name: 'fix-flaky-build-dispatch-from-asana',
      baseBranch: undefined,
      brief: 'Fix flaky build dispatch from Asana lane quickly please',
      buildAgent: 'claude'
    })
  })

  it('returns an error with available repos when dispatch repo cannot be resolved', async () => {
    const { setBuildDispatcher, setRepoLister } = await import('../agent-dispatch-registry')
    const dispatch = vi.fn(async () => ({ worktreeId: 'wt-3', ok: true }))
    setRepoLister(() => [{ id: 'repo-1', name: 'DobiusPlus' }])
    setBuildDispatcher(dispatch)

    const handlers = createDobiusToolHandlers(context, store)
    const result = await handlers.dispatchBuild({ repo: 'Unknown', brief: 'Do the work' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('DobiusPlus')
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('blocks build dispatch while the crew is paused', async () => {
    const { setBuildDispatcher, setRepoLister } = await import('../agent-dispatch-registry')
    const dispatch = vi.fn(async () => ({ worktreeId: 'wt-4', ok: true }))
    setRepoLister(() => [{ id: 'repo-1', name: 'DobiusPlus' }])
    setBuildDispatcher(dispatch)
    mocks.checkExecutionAdmission.mockReturnValue({
      allowed: false,
      reason: 'paused',
      message: 'Crew is paused.'
    })

    const handlers = createDobiusToolHandlers(context, store)
    const result = await handlers.dispatchBuild({ repo: 'repo-1', brief: 'Do the work' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('blocked')
    expect(mocks.checkExecutionAdmission).toHaveBeenCalledWith('dispatch-build')
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('lists crew without leaking cwd paths', async () => {
    const handlers = createDobiusToolHandlers(context, store)
    const result = await handlers.listCrew()
    expect(result.content[0].text).toContain('Builder')
    expect(result.content[0].text).toContain('heartbeat:on')
    expect(result.content[0].text).not.toContain('/secret/path')
  })

  it('returns compact crew status without leaking token-like summaries', async () => {
    const handlers = createDobiusToolHandlers(context, store)
    const result = await handlers.crewStatus()
    expect(result.content[0].text).toContain('Builder: idle - last success')
    expect(result.content[0].text).not.toContain('abc123')
    expect(result.content[0].text).not.toContain('/secret/path')
  })
})

const CREW = [
  'asana_draft_comment',
  'read_knowledge',
  'list_crew',
  'crew_status',
  'file_briefing_item'
]

function registeredToolNames(toolContext: DobiusToolContext): string[] {
  const server = buildDobiusToolServer(toolContext) as unknown as { tools: { name: string }[] }
  return server.tools.map((entry) => entry.name).sort()
}

describe('run capability profiles', () => {
  it.each([
    ['manual', { source: 'manual' as const }, CREW],
    ['heartbeat', { source: 'heartbeat' as const }, CREW],
    [
      'channel',
      { source: 'channel' as const },
      ['post_channel_message', 'post_channel_screenshot', 'create_board_task', ...CREW]
    ],
    [
      'asana build-lane triage',
      { source: 'asana' as const, asanaLane: 'build' as const, asanaTaskGid: '1200' },
      ['file_briefing_item', 'asana_draft_comment', 'read_knowledge', 'dispatch_build']
    ],
    [
      'asana build-lane triage without a trusted task gid',
      { source: 'asana' as const, asanaLane: 'build' as const },
      ['file_briefing_item', 'asana_draft_comment', 'read_knowledge']
    ],
    [
      'iMessage run (recorded as channel)',
      { source: 'channel' as const, profile: 'imessage' as const },
      ['read_knowledge', 'list_crew', 'crew_status', 'file_briefing_item']
    ],
    [
      'asana review-lane triage',
      { source: 'asana' as const, asanaLane: 'review' as const },
      ['file_briefing_item', 'asana_draft_comment', 'read_knowledge']
    ],
    [
      'asana triage without a trusted lane',
      { source: 'asana' as const },
      ['file_briefing_item', 'asana_draft_comment', 'read_knowledge']
    ],
    [
      'voice conductor (recorded as channel)',
      { source: 'channel' as const, profile: 'voice-conductor' as const },
      []
    ],
    [
      'a non-asana run that claims a build lane',
      { source: 'channel' as const, asanaLane: 'build' as const, asanaTaskGid: '1200' },
      ['post_channel_message', 'post_channel_screenshot', 'create_board_task', ...CREW]
    ]
  ])('%s gets exactly its tool set', (_label, input, expected) => {
    const profile = resolveAgentRunProfile(input)
    expect([...profile.dobiusTools].sort()).toEqual([...expected].sort())
    const names = registeredToolNames({
      agentId: 'agent-1',
      runId: 'run-x',
      tools: profile.dobiusTools,
      buildLane: profile.buildLane,
      asanaTaskGid: profile.asanaTaskGid
    })
    expect(names).toEqual([...expected].sort())
  })

  it('never offers dispatch_build outside a build-lane Asana run', () => {
    for (const source of ['manual', 'heartbeat', 'channel'] as const) {
      expect(resolveAgentRunProfile({ source, asanaLane: 'build' }).dobiusTools).not.toContain(
        'dispatch_build'
      )
    }
  })
})

describe('dispatch_build authorization and capacity', () => {
  async function wireRepos(
    dispatch: (req: unknown) => Promise<{ worktreeId: string; ok: boolean; error?: string }>
  ) {
    const { setBuildDispatcher, setRepoLister } = await import('../agent-dispatch-registry')
    setRepoLister(() => [{ id: 'repo-1', name: 'DobiusPlus' }])
    setBuildDispatcher(dispatch)
  }

  it.each([
    ['a channel run', { tools: resolveAgentRunProfile({ source: 'channel' }).dobiusTools }],
    ['a manual run', { tools: resolveAgentRunProfile({ source: 'manual' }).dobiusTools }],
    [
      'a build-lane run without the build capability',
      {
        tools: resolveAgentRunProfile({ source: 'asana' }).dobiusTools,
        buildLane: 'build' as const,
        asanaTaskGid: 'gid-no-capability'
      }
    ],
    [
      'a review-lane triage run given the tool anyway',
      { tools: context.tools, buildLane: 'review' as const, asanaTaskGid: 'gid-review' }
    ],
    ['a run with the tool but no trusted lane', { tools: context.tools, buildLane: undefined }],
    [
      'a build-lane run with the tool but no trusted task gid',
      { tools: context.tools, buildLane: 'build' as const, asanaTaskGid: undefined }
    ]
  ])('denies %s before admission or dispatch', async (_label, overrides) => {
    const dispatch = vi.fn(async () => ({ worktreeId: 'wt-x', ok: true }))
    await wireRepos(dispatch)
    const handlers = createDobiusToolHandlers(
      { agentId: 'agent-1', runId: 'run-deny', ...overrides },
      store
    )
    const result = await handlers.dispatchBuild({ repo: 'repo-1', brief: 'Do the work' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('not permitted')
    expect(dispatch).not.toHaveBeenCalled()
    expect(mocks.checkExecutionAdmission).not.toHaveBeenCalled()
  })

  it('reserves capacity so concurrent dispatches cannot oversubscribe, and releases it on success', async () => {
    let finish: (value: { worktreeId: string; ok: boolean }) => void = () => {}
    const dispatch = vi.fn(async () => ({ worktreeId: 'wt-next', ok: true }))
    // Only the first dispatch stays pending until the test finishes it.
    dispatch.mockImplementationOnce(
      () =>
        new Promise<{ worktreeId: string; ok: boolean }>((resolve) => {
          finish = resolve
        })
    )
    await wireRepos(dispatch)
    const first = createDobiusToolHandlers(buildRun('run-a'), store).dispatchBuild({
      repo: 'repo-1',
      brief: 'First build'
    })
    const second = await createDobiusToolHandlers(buildRun('run-b'), store).dispatchBuild({
      repo: 'repo-1',
      brief: 'Second build'
    })
    expect(second.isError).toBe(true)
    expect(second.content[0].text).toContain('in progress')
    expect(dispatch).toHaveBeenCalledTimes(1)

    finish({ worktreeId: 'wt-a', ok: true })
    expect((await first).isError).toBeUndefined()

    const third = await createDobiusToolHandlers(buildRun('run-c'), store).dispatchBuild({
      repo: 'repo-1',
      brief: 'Third build'
    })
    expect(third.isError).toBeUndefined()
  })

  it('allows one build per Asana task within a run', async () => {
    const dispatch = vi.fn(async () => ({ worktreeId: 'wt-1', ok: true }))
    await wireRepos(dispatch)
    const handlers = createDobiusToolHandlers(buildRun('run-once'), store)
    expect((await handlers.dispatchBuild({ repo: 'repo-1', brief: 'One' })).isError).toBeUndefined()
    const again = await handlers.dispatchBuild({ repo: 'repo-1', brief: 'Two' })
    expect(again.isError).toBe(true)
    expect(again.content[0].text).toContain('already dispatched')
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('releases the reservation when the dispatcher throws or reports failure', async () => {
    const dispatch = vi
      .fn<(req: unknown) => Promise<{ worktreeId: string; ok: boolean; error?: string }>>()
      .mockRejectedValueOnce(new Error('git exploded'))
      .mockResolvedValueOnce({ worktreeId: '', ok: false, error: 'branch exists' })
      .mockResolvedValueOnce({ worktreeId: 'wt-ok', ok: true })
    await wireRepos(dispatch)
    const handlers = createDobiusToolHandlers(buildRun('run-retry'), store)
    const thrown = await handlers.dispatchBuild({ repo: 'repo-1', brief: 'Build' })
    expect(thrown.content[0].text).toContain('git exploded')
    const failed = await handlers.dispatchBuild({ repo: 'repo-1', brief: 'Build' })
    expect(failed.content[0].text).toContain('branch exists')
    const ok = await handlers.dispatchBuild({ repo: 'repo-1', brief: 'Build' })
    expect(ok.isError).toBeUndefined()
    expect(dispatch).toHaveBeenCalledTimes(3)
  })

  it('records the build before the dispatcher runs, so a crash mid-dispatch cannot re-dispatch (BUILD-024)', async () => {
    const ledger = await import('../asana-dispatch-ledger')
    const run = buildRun('run-premark')
    const gid = run.asanaTaskGid as string
    let seenDuringDispatch: boolean | null = null
    const dispatch = vi
      .fn<(req: unknown) => Promise<{ worktreeId: string; ok: boolean; error?: string }>>()
      .mockImplementationOnce(async () => {
        seenDuringDispatch = ledger.mayDispatchBuild(gid)
        return { worktreeId: '', ok: false, error: 'branch exists' }
      })
    await wireRepos(dispatch)
    await createDobiusToolHandlers(run, store).dispatchBuild({ repo: 'repo-1', brief: 'Build' })
    // While the worktree was being created the task was already marked.
    expect(seenDuringDispatch).toBe(false)
    // A definite failure clears the mark again, so the task may retry.
    expect(ledger.mayDispatchBuild(gid)).toBe(true)
  })

  it('does not consume capacity when admission blocks', async () => {
    const dispatch = vi.fn(async () => ({ worktreeId: 'wt-1', ok: true }))
    await wireRepos(dispatch)
    const handlers = createDobiusToolHandlers(buildRun('run-blocked'), store)
    mocks.checkExecutionAdmission.mockReturnValueOnce({
      allowed: false,
      reason: 'paused',
      message: 'Crew is paused.'
    })
    expect((await handlers.dispatchBuild({ repo: 'repo-1', brief: 'Build' })).isError).toBe(true)
    expect(
      (await handlers.dispatchBuild({ repo: 'repo-1', brief: 'Build' })).isError
    ).toBeUndefined()
    expect(dispatch).toHaveBeenCalledTimes(1)
  })
})

describe('dispatch_build is one build per Asana task', () => {
  it('refuses a second dispatch after the first triage run fails and the task is re-claimed', async () => {
    const ledger = await import('../asana-dispatch-ledger')
    const { setBuildDispatcher, setRepoLister } = await import('../agent-dispatch-registry')
    const dispatch = vi.fn(async () => ({ worktreeId: 'wt-1', ok: true }))
    setRepoLister(() => [{ id: 'repo-1', name: 'DobiusPlus' }])
    setBuildDispatcher(dispatch)
    const gid = freshGid()
    const run = (runId: string) =>
      createDobiusToolHandlers({ ...context, runId, asanaTaskGid: gid }, store)

    expect(ledger.claimTask(gid, 'build')).not.toBeNull()
    expect((await run('run-1').dispatchBuild({ repo: 'repo-1', brief: 'Build' })).isError).toBe(
      undefined
    )
    // The triage run then fails (turn cap, budget, bad verdict).
    ledger.recordFailure(gid)
    expect(ledger.claimTask(gid, 'build')).toBeNull()

    // Even a run that somehow started for the same task cannot dispatch again.
    const second = await run('run-2').dispatchBuild({ repo: 'repo-1', brief: 'Build' })
    expect(second.isError).toBe(true)
    expect(second.content[0].text).toContain(`already dispatched for Asana task ${gid}`)
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('times out a never-settling dispatch, frees the slot, and logs the late result once', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const { BUILD_DISPATCH_TIMEOUT_MS } = await import('./dispatch-build-handler')
      const ledger = await import('../asana-dispatch-ledger')
      const { setBuildDispatcher, setRepoLister } = await import('../agent-dispatch-registry')
      let lateFinish: (value: { worktreeId: string; ok: boolean }) => void = () => {}
      const dispatch = vi.fn(async () => ({ worktreeId: 'wt-after', ok: true }))
      dispatch.mockImplementationOnce(
        () =>
          new Promise<{ worktreeId: string; ok: boolean }>((resolve) => {
            lateFinish = resolve
          })
      )
      setRepoLister(() => [{ id: 'repo-1', name: 'DobiusPlus' }])
      setBuildDispatcher(dispatch)
      const stuck = buildRun('run-stuck')

      const pending = createDobiusToolHandlers(stuck, store).dispatchBuild({
        repo: 'repo-1',
        brief: 'Build'
      })
      await vi.advanceTimersByTimeAsync(BUILD_DISPATCH_TIMEOUT_MS)
      const timedOut = await pending
      expect(timedOut.isError).toBe(true)
      expect(timedOut.content[0].text).toContain('timed out')
      // Outcome unknown → fail closed for that task.
      expect(ledger.mayDispatchBuild(stuck.asanaTaskGid as string)).toBe(false)

      // The app-wide slot is free again for another task.
      const next = await createDobiusToolHandlers(buildRun('run-next'), store).dispatchBuild({
        repo: 'repo-1',
        brief: 'Build'
      })
      expect(next.isError).toBeUndefined()

      lateFinish({ worktreeId: 'wt-late', ok: true })
      await vi.advanceTimersByTimeAsync(0)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0][0])).toContain('wt-late')

      // A late result must not release a second time: one slot still means one in flight.
      let hold: (value: { worktreeId: string; ok: boolean }) => void = () => {}
      dispatch.mockImplementationOnce(
        () =>
          new Promise<{ worktreeId: string; ok: boolean }>((resolve) => {
            hold = resolve
          })
      )
      const held = createDobiusToolHandlers(buildRun('run-held'), store).dispatchBuild({
        repo: 'repo-1',
        brief: 'Build'
      })
      const blocked = await createDobiusToolHandlers(buildRun('run-blocked'), store).dispatchBuild({
        repo: 'repo-1',
        brief: 'Build'
      })
      expect(blocked.content[0].text).toContain('in progress')
      hold({ worktreeId: 'wt-held', ok: true })
      await held
    } finally {
      warn.mockRestore()
      vi.useRealTimers()
    }
  })
})

describe('create_board_task', () => {
  it.each([undefined, 'todo' as const])(
    'creates agent cards in Backlog so they never auto-dispatch (requested status %s)',
    async (status) => {
      const { vertexTaskStore } = await import('../../vertex/vertex-task-store')
      const create = vi
        .spyOn(vertexTaskStore, 'create')
        .mockImplementation((input) => ({ id: 'task-1', ...input }) as never)
      try {
        const handlers = createDobiusToolHandlers(context, store)
        const result = await handlers.createBoardTask({
          title: 'Follow up',
          assignee: 'Builder',
          ...(status ? { status } : {})
        })
        expect(create.mock.calls[0][0]).toMatchObject({ status: 'backlog' })
        expect(result.content[0].text).toContain('in backlog')
      } finally {
        create.mockRestore()
      }
    }
  )

  it('keeps a non-dispatching status the agent chose', async () => {
    const { vertexTaskStore } = await import('../../vertex/vertex-task-store')
    const create = vi
      .spyOn(vertexTaskStore, 'create')
      .mockImplementation((input) => ({ id: 'task-2', ...input }) as never)
    try {
      await createDobiusToolHandlers(context, store).createBoardTask({
        title: 'Blocked item',
        status: 'blocked'
      })
      expect(create.mock.calls[0][0]).toMatchObject({ status: 'blocked' })
    } finally {
      create.mockRestore()
    }
  })
})
