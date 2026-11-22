import { beforeEach, describe, expect, it, vi } from 'vitest'

type TestEvent = { runId: string; kind: string; detail?: string; toolName?: string }

const mocks = vi.hoisted(() => ({
  paused: false,
  engine: 'claude' as 'claude' | 'codex',
  query: vi.fn(),
  precheck: vi.fn(),
  sandboxFailure: null as string | null,
  storedSessionId: 'session-1',
  pinned: new Set<string>(),
  subscribe: vi.fn(),
  startCodexAgentProcess: vi.fn(),
  runs: new Map<string, Record<string, unknown>>(),
  events: [] as { runId: string; kind: string; detail?: string; toolName?: string }[],
  listeners: new Set<(event: { runId: string; kind: string }) => void>()
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mocks.query }))
// The real module runs sandbox-exec; it has its own test. Here `precheck`
// stands for the sandboxed check and `sandboxFailure` for a sandbox that
// could not be applied.
vi.mock('./agent-run-postcheck-sandbox', () => ({
  runSandboxedPostcheck: async (args: unknown) =>
    mocks.sandboxFailure
      ? { ok: false, reason: mocks.sandboxFailure }
      : { ok: true, result: await mocks.precheck(args) }
}))
vi.mock('./agents-config-store', () => ({
  getAgentsControlState: () => ({
    paused: mocks.paused,
    status: 'ok',
    detail: null,
    filePath: '/data/agents-config.json'
  })
}))
vi.mock('./agents-store', () => ({
  getAgent: (id: string) => ({
    id,
    name: 'Atlas',
    engine: mocks.engine,
    model: 'claude-opus-4-8',
    allowedTools: ['Read'],
    skills: [],
    cwd: '/repo',
    bypassPermissions: false
  }),
  getAgentSessionForKey: () => ({ sessionId: mocks.storedSessionId, cwd: '/repo' }),
  updateAgentSession: vi.fn()
}))
vi.mock('./agent-runs-store', () => ({
  addStoredAgentRun: (run: { id: string }) => mocks.runs.set(run.id, { ...run }),
  getStoredAgentRun: (id: string) => mocks.runs.get(id),
  listStoredAgentRuns: () => Array.from(mocks.runs.values()),
  pinStoredAgentRun: (id: string) => mocks.pinned.add(id),
  unpinStoredAgentRun: (id: string) => mocks.pinned.delete(id),
  updateStoredAgentRun: (id: string, updates: Record<string, unknown>) => {
    const run = mocks.runs.get(id)
    if (run) {
      Object.assign(run, updates)
    }
    return Boolean(run)
  }
}))
vi.mock('./agent-run-events', () => ({
  broadcastRunEvent: (event: TestEvent) => {
    mocks.events.push(event)
    for (const listener of mocks.listeners) {
      listener(event)
    }
  },
  broadcastRunsChanged: vi.fn(),
  eventBase: (runId: string, agentId: string) => ({ runId, agentId, ts: 0 }),
  // Test messages carry the run events they should turn into.
  reduceMessage: (message: { testEvents?: object[] }, runId: string, agentId: string) =>
    (message.testEvents ?? []).map((event) => ({ runId, agentId, ts: 0, ...event })),
  subscribeToAgentRunEvents: mocks.subscribe
}))
vi.mock('./agent-decision-queue', () => ({
  createAgentCanUseTool: vi.fn(),
  denyPendingDecisionsForRun: vi.fn(),
  setDecisionBypassRunHandler: vi.fn()
}))
vi.mock('./agent-hard-rails', () => ({ buildAgentHardRailHooks: vi.fn(() => ({})) }))
vi.mock('./agent-sandbox-context', () => ({
  resolveAgentRunSandboxPolicy: () => ({ sandbox: { enabled: true }, disallowedTools: [] })
}))
vi.mock('./agent-notification-store', () => ({ appendAgentRunNotification: vi.fn() }))
vi.mock('./agent-run-progress-log', () => ({ appendRunProgress: vi.fn() }))
vi.mock('./agent-runner-environment', () => ({
  buildRunEnv: vi.fn(() => ({})),
  currentGitBranch: vi.fn(() => 'main'),
  resolveAgentRunCwd: (cwd: string) => cwd
}))
vi.mock('./session-workspace-brief', () => ({
  scheduleSessionWorkspaceBriefRefresh: vi.fn(async () => ({}))
}))
vi.mock('./agent-runner-dobius-tools', () => ({
  buildDobiusRunMcpServer: vi.fn(() => ({})),
  buildProfileAllowedTools: (_profile: unknown, tools: string[]) => tools,
  builtInToolsFor: () => undefined,
  resolveAgentRunProfile: () => ({ id: 'manual', dobiusTools: [], channelBaseline: false })
}))
vi.mock('./agent-run-prompt', () => ({ buildSystemPrompt: () => '' }))
vi.mock('./default-codex-launch', () => ({ getDefaultPrepareCodexLaunch: () => () => null }))
vi.mock('./codex-agent-execution', () => ({
  startCodexAgentProcess: mocks.startCodexAgentProcess
}))
vi.mock('../codex-cli/command', () => ({ resolveClaudeCommand: () => 'claude' }))

import { startAgentRun, stopAgentRun } from './agent-runner'
import { claimRunSession, releaseRunSession } from './agent-session-lease'

type StreamSpec = { subtype?: 'success' | 'error_max_turns'; cost?: number; events?: object[] }

function streamOf(spec: StreamSpec = {}) {
  async function* stream() {
    yield { type: 'system', subtype: 'init', session_id: 'session-1' }
    if (spec.events) {
      yield { type: 'assistant', testEvents: spec.events }
    }
    yield {
      type: 'result',
      subtype: spec.subtype ?? 'success',
      session_id: 'session-1',
      result: 'ok',
      errors: ['out of turns'],
      num_turns: 1,
      total_cost_usd: spec.cost ?? 0.5
    }
  }
  return Object.assign(stream(), { setPermissionMode: vi.fn(), interrupt: vi.fn(async () => {}) })
}

function checkResult(exitCode: number, stdout = '') {
  return {
    command: 'npm test',
    exitCode,
    timedOut: false,
    durationMs: 5,
    stdout,
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    error: null,
    startedAt: 1,
    completedAt: 6
  }
}

const prepareClaudeLaunch = vi.fn(async () => ({}) as never)
const postcheck = { command: 'npm test', timeoutSeconds: 60 }

function callbacks() {
  const order: string[] = []
  return {
    order,
    onResult: vi.fn(() => order.push('result')),
    onRunEnded: vi.fn((status: string) => order.push(`ended:${status}`)),
    onSettled: vi.fn(() => order.push('settled'))
  }
}

function start(options: NonNullable<Parameters<typeof startAgentRun>[0]['options']>) {
  return startAgentRun({ agentId: 'a', prompt: 'build it', prepareClaudeLaunch, options })
}

function storedRuns() {
  return Array.from(mocks.runs.values())
}

function loopNotes(): string[] {
  return mocks.events.filter((event) => event.kind === 'system').map((event) => event.detail ?? '')
}

beforeEach(() => {
  mocks.paused = false
  mocks.engine = 'claude'
  mocks.sandboxFailure = null
  mocks.storedSessionId = 'session-1'
  mocks.pinned.clear()
  mocks.runs.clear()
  mocks.events.length = 0
  mocks.listeners.clear()
  mocks.query.mockReset()
  mocks.query.mockImplementation(() => streamOf())
  mocks.precheck.mockReset()
  mocks.subscribe.mockReset()
  mocks.subscribe.mockImplementation((listener: (event: { runId: string; kind: string }) => void) => {
    mocks.listeners.add(listener)
    return () => mocks.listeners.delete(listener)
  })
  mocks.startCodexAgentProcess.mockReset()
})

describe('a run with no check behaves exactly as before the loop', () => {
  it('fires onResult then onSettled, records nothing extra and never runs a check', async () => {
    const cb = callbacks()
    const runId = await start({ onResult: cb.onResult, onRunEnded: cb.onRunEnded, onSettled: cb.onSettled })

    await vi.waitFor(() => expect(cb.onSettled).toHaveBeenCalledTimes(1))
    expect(cb.order).toEqual(['result', 'settled'])
    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(mocks.precheck).not.toHaveBeenCalled()
    expect(mocks.subscribe).not.toHaveBeenCalled()
    expect(loopNotes()).toEqual(['Run accepted'])
    // Exactly the fields the runner wrote before the loop existed.
    expect(Object.keys(mocks.runs.get(runId) ?? {}).toSorted()).toEqual(
      [
        'agentId',
        'context',
        'costUsd',
        'endedAt',
        'id',
        'numTurns',
        'prompt',
        'sessionKey',
        'source',
        'startedAt',
        'status',
        'summary'
      ].toSorted()
    )
  })

  it('fires the callbacks in the same tick as the runner, not after a held step', async () => {
    const order: string[] = []
    mocks.query.mockImplementation(() => {
      async function* stream() {
        yield {
          type: 'result',
          subtype: 'success',
          session_id: 's',
          result: 'ok',
          errors: [],
          num_turns: 1,
          total_cost_usd: 0
        }
        order.push('stream-done')
      }
      return Object.assign(stream(), { setPermissionMode: vi.fn(), interrupt: vi.fn() })
    })
    const onSettled = vi.fn(() => order.push('settled'))
    await start({ onResult: () => order.push('result'), onSettled })

    await vi.waitFor(() => expect(onSettled).toHaveBeenCalled())
    // onResult fires live, while the stream is still open.
    expect(order).toEqual(['result', 'stream-done', 'settled'])
  })

  it('treats an empty check command as no check', async () => {
    const cb = callbacks()
    await start({ postcheck: { command: '   ', timeoutSeconds: 60 }, onSettled: cb.onSettled })

    await vi.waitFor(() => expect(cb.onSettled).toHaveBeenCalledTimes(1))
    expect(mocks.precheck).not.toHaveBeenCalled()
    expect(mocks.subscribe).not.toHaveBeenCalled()
  })
})

describe('postcheck and retry', () => {
  it('retries once when the check fails, then reports the last attempt once', async () => {
    mocks.query.mockImplementation(() => streamOf({ cost: 1.8 }))
    mocks.precheck
      .mockResolvedValueOnce(checkResult(1, 'FAIL src/a.test.ts'))
      .mockResolvedValueOnce(checkResult(0))
    const cb = callbacks()
    const firstId = await start({ postcheck, ...cb })

    await vi.waitFor(() => expect(cb.onSettled).toHaveBeenCalledTimes(1))
    expect(mocks.query).toHaveBeenCalledTimes(2)
    expect(cb.order).toEqual(['result', 'settled'])
    expect(cb.onRunEnded).not.toHaveBeenCalled()

    const retry = mocks.query.mock.calls[1][0]
    expect(retry.prompt).toContain('FAIL src/a.test.ts')
    expect(retry.prompt).toContain('Command: npm test')
    // The retry continues the same session, on what the loop budget has left.
    expect(retry.options.resume).toBe('session-1')
    expect(retry.options.maxBudgetUsd).toBeCloseTo(1.2)

    const [first, second] = storedRuns()
    expect(first).toMatchObject({ id: firstId, attempt: 1, rootRunId: firstId })
    expect(first.postcheck).toMatchObject({ exitCode: 1 })
    expect(first.outcome).toBeUndefined()
    expect(second).toMatchObject({
      attempt: 2,
      rootRunId: firstId,
      outcome: 'verified',
      sessionKey: 'default',
      context: { correlationId: firstId }
    })
    expect(second.loopCostUsd).toBeCloseTo(3.6)
    expect(loopNotes()).toEqual([
      'Run accepted',
      'postcheck: failed exit 1, retry 1 of 1',
      'Run accepted',
      'postcheck: passed',
      'loop: verified, the check passed'
    ])
  })

  it('stops as blocked after exactly two runs when the check keeps failing', async () => {
    mocks.precheck.mockResolvedValue(checkResult(1))
    const cb = callbacks()
    await start({ postcheck, ...cb })

    await vi.waitFor(() => expect(cb.onSettled).toHaveBeenCalledTimes(1))
    expect(mocks.query).toHaveBeenCalledTimes(2)
    expect(mocks.precheck).toHaveBeenCalledTimes(2)
    expect(cb.onResult).toHaveBeenCalledTimes(1)
    expect(storedRuns().map((run) => run.outcome)).toEqual([undefined, 'blocked'])
    expect(loopNotes().at(-1)).toBe('loop: blocked, after 2 attempts')
  })

  it('runs no check and no retry for a run that used an outward tool', async () => {
    mocks.query.mockImplementation(() =>
      streamOf({
        events: [
          { kind: 'tool-use', toolName: 'Read', detail: '{}' },
          { kind: 'tool-use', toolName: 'mcp__claude_ai_Gmail__send_message', detail: '{}' }
        ]
      })
    )
    mocks.precheck.mockResolvedValue(checkResult(1))
    const cb = callbacks()
    await start({ postcheck, ...cb })

    await vi.waitFor(() => expect(cb.onSettled).toHaveBeenCalledTimes(1))
    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(mocks.precheck).not.toHaveBeenCalled()
    expect(storedRuns()[0].outcome).toBe('needs-review')
    expect(loopNotes().at(-1)).toContain('check not run (mcp__claude_ai_Gmail__send_message)')
    expect(mocks.listeners.size).toBe(0)
  })

  it('runs no check and no retry after a Bash command that is not known to be local', async () => {
    mocks.query.mockImplementation(() =>
      streamOf({
        events: [{ kind: 'tool-use', toolName: 'Bash', detail: '{"command":"git status; curl x"}' }]
      })
    )
    mocks.precheck.mockResolvedValue(checkResult(1))
    const cb = callbacks()
    await start({ postcheck, ...cb })

    await vi.waitFor(() => expect(cb.onSettled).toHaveBeenCalledTimes(1))
    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(mocks.precheck).not.toHaveBeenCalled()
    expect(storedRuns()[0].outcome).toBe('needs-review')
  })

  it.each([
    '/repo/package.json',
    '/repo/pnpm-lock.yaml',
    '/repo/vitest.config.ts',
    '/repo/tsconfig.json',
    '/repo/.git/hooks/pre-commit',
    '/repo/node_modules/.bin/vitest',
    '/repo/.husky/pre-commit'
  ])('runs no check and no retry when the run wrote %s', async (filePath) => {
    mocks.query.mockImplementation(() =>
      streamOf({
        events: [{ kind: 'tool-use', toolName: 'Edit', detail: JSON.stringify({ file_path: filePath }) }]
      })
    )
    mocks.precheck.mockResolvedValue(checkResult(0))
    const cb = callbacks()
    await start({ postcheck, ...cb })

    await vi.waitFor(() => expect(cb.onSettled).toHaveBeenCalledTimes(1))
    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(mocks.precheck).not.toHaveBeenCalled()
    expect(storedRuns()[0].outcome).toBe('needs-review')
    expect(storedRuns()[0].postcheck).toBeUndefined()
    expect(loopNotes().at(-1)).toBe('loop: needs review, the run changed tooling; check not run')
    expect(cb.order).toEqual(['result', 'settled'])
  })

  it('runs no check when a Bash command changed tooling', async () => {
    mocks.query.mockImplementation(() =>
      streamOf({
        events: [{ kind: 'tool-use', toolName: 'Bash', detail: '{"command":"echo x > package.json"}' }]
      })
    )
    const cb = callbacks()
    await start({ postcheck, ...cb })

    await vi.waitFor(() => expect(cb.onSettled).toHaveBeenCalledTimes(1))
    expect(mocks.precheck).not.toHaveBeenCalled()
    expect(storedRuns()[0].outcome).toBe('needs-review')
  })

  it('retries after local-only tools', async () => {
    mocks.query.mockImplementation(() =>
      streamOf({
        events: [
          { kind: 'tool-use', toolName: 'Edit', detail: '{"file_path":"/repo/src/a.ts"}' },
          { kind: 'tool-use', toolName: 'Bash', detail: '{"command":"npm test"}' }
        ]
      })
    )
    mocks.precheck.mockResolvedValueOnce(checkResult(1)).mockResolvedValueOnce(checkResult(0))
    const cb = callbacks()
    await start({ postcheck, ...cb })

    await vi.waitFor(() => expect(cb.onSettled).toHaveBeenCalledTimes(1))
    expect(mocks.query).toHaveBeenCalledTimes(2)
  })

  it('hands the check and the run folder to the sandboxed runner', async () => {
    mocks.precheck.mockResolvedValue(checkResult(0))
    const cb = callbacks()
    await start({ postcheck, ...cb })

    await vi.waitFor(() => expect(cb.onSettled).toHaveBeenCalledTimes(1))
    expect(mocks.precheck).toHaveBeenCalledWith({ postcheck, cwd: '/repo' })
  })

  it('does not run the check when the sandbox cannot be applied', async () => {
    mocks.sandboxFailure = 'the sandbox did not start (sandbox_apply: Operation not permitted)'
    const cb = callbacks()
    await start({ postcheck, ...cb })

    await vi.waitFor(() => expect(cb.onSettled).toHaveBeenCalledTimes(1))
    expect(mocks.precheck).not.toHaveBeenCalled()
    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(storedRuns()[0].outcome).toBe('needs-review')
    expect(storedRuns()[0].postcheck).toBeUndefined()
    expect(loopNotes().at(-1)).toContain('check not run')
    expect(cb.order).toEqual(['result', 'settled'])
  })

  it('refuses the retry when another run replaced the conversation during the check', async () => {
    mocks.precheck.mockImplementation(async () => {
      mocks.storedSessionId = 'session-of-another-run'
      return checkResult(1)
    })
    const cb = callbacks()
    await start({ postcheck, ...cb })

    await vi.waitFor(() => expect(cb.onSettled).toHaveBeenCalledTimes(1))
    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(storedRuns()[0].outcome).toBe('blocked')
    expect(loopNotes().at(-1)).toBe('loop: blocked, another run has since used this conversation')
  })

  it('refuses the retry while another run holds the conversation', async () => {
    mocks.precheck.mockImplementation(async () => {
      claimRunSession('other-run', 'a', 'default')
      return checkResult(1)
    })
    const cb = callbacks()
    try {
      await start({ postcheck, ...cb })
      await vi.waitFor(() => expect(cb.onSettled).toHaveBeenCalledTimes(1))
    } finally {
      releaseRunSession('other-run')
    }
    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(storedRuns()[0].outcome).toBe('blocked')
  })

  it('keeps the run record pinned for as long as its check is running', async () => {
    let pinnedDuringCheck: string[] = []
    mocks.precheck.mockImplementation(async () => {
      pinnedDuringCheck = Array.from(mocks.pinned)
      return checkResult(0)
    })
    const cb = callbacks()
    const runId = await start({ postcheck, ...cb })

    await vi.waitFor(() => expect(cb.onSettled).toHaveBeenCalledTimes(1))
    expect(pinnedDuringCheck).toEqual([runId])
    expect(mocks.pinned.size).toBe(0)
  })

  it('leaves no record pinned after a retried loop', async () => {
    mocks.precheck.mockResolvedValueOnce(checkResult(1)).mockResolvedValueOnce(checkResult(0))
    const cb = callbacks()
    await start({ postcheck, ...cb })

    await vi.waitFor(() => expect(cb.onSettled).toHaveBeenCalledTimes(1))
    expect(mocks.query).toHaveBeenCalledTimes(2)
    expect(mocks.pinned.size).toBe(0)
  })

  it('does not retry while the crew is paused', async () => {
    mocks.precheck.mockImplementation(async () => {
      mocks.paused = true
      return checkResult(1)
    })
    const cb = callbacks()
    await start({ postcheck, ...cb })

    await vi.waitFor(() => expect(cb.onSettled).toHaveBeenCalledTimes(1))
    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(storedRuns()[0].outcome).toBe('blocked')
    expect(loopNotes().at(-1)).toBe('loop: blocked, the crew is paused')
  })

  it.each([
    ['channel', { source: 'channel' as const }],
    ['heartbeat', { source: 'heartbeat' as const }],
    ['iMessage', { sessionKey: 'imessage' }],
    ['voice', { spawnedBy: 'voice-conductor' as const }]
  ])('does not retry a %s run', async (_label, extra) => {
    mocks.precheck.mockResolvedValue(checkResult(1))
    const cb = callbacks()
    await start({ postcheck, ...cb, ...extra })

    await vi.waitFor(() => expect(cb.onSettled).toHaveBeenCalledTimes(1))
    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(storedRuns()[0].outcome).toBe('blocked')
  })

  it('refuses a check on a Codex run before anything starts', async () => {
    mocks.engine = 'codex'
    await expect(start({ postcheck })).rejects.toMatchObject({ name: 'CodexRunUnsupportedError' })
    expect(mocks.startCodexAgentProcess).not.toHaveBeenCalled()
    expect(mocks.precheck).not.toHaveBeenCalled()
    expect(storedRuns()).toEqual([])
  })

  it('does not retry when the loop budget is spent', async () => {
    mocks.query.mockImplementation(() => streamOf({ cost: 0.9 }))
    mocks.precheck.mockResolvedValue(checkResult(1))
    const cb = callbacks()
    // Ceiling 1.5 x $0.70 = $1.05; $0.90 spent leaves $0.15, under the $0.25 floor.
    await start({ postcheck, maxBudgetUsd: 0.7, ...cb })

    await vi.waitFor(() => expect(cb.onSettled).toHaveBeenCalledTimes(1))
    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(loopNotes().at(-1)).toBe('loop: blocked, the loop budget is spent')
  })

  it('skips the check for a run that ended in error', async () => {
    mocks.query.mockImplementation(() => streamOf({ subtype: 'error_max_turns' }))
    const cb = callbacks()
    await start({ postcheck, ...cb })

    await vi.waitFor(() => expect(cb.onSettled).toHaveBeenCalledTimes(1))
    expect(mocks.precheck).not.toHaveBeenCalled()
    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(storedRuns()[0].outcome).toBe('blocked')
    expect(cb.order).toEqual(['result', 'settled'])
  })

  it('skips the check and records no outcome for a stopped run', async () => {
    mocks.query.mockImplementation(({ options }: { options: { abortController: AbortController } }) => ({
      [Symbol.asyncIterator]: () => ({
        next: () =>
          new Promise((resolve) => {
            options.abortController.signal.addEventListener('abort', () =>
              resolve({ done: true, value: undefined })
            )
          })
      }),
      setPermissionMode: vi.fn(),
      interrupt: vi.fn(async () => {})
    }))
    const cb = callbacks()
    const runId = await start({ postcheck, ...cb })
    await stopAgentRun(runId)

    await vi.waitFor(() => expect(cb.onSettled).toHaveBeenCalledTimes(1))
    expect(cb.order).toEqual(['ended:cancelled', 'settled'])
    expect(mocks.precheck).not.toHaveBeenCalled()
    expect(mocks.runs.get(runId)?.outcome).toBeUndefined()
  })

  it('still reports to the caller when the check itself throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.precheck.mockRejectedValue(new Error('spawn failed'))
    const cb = callbacks()
    await start({ postcheck, ...cb })

    await vi.waitFor(() => expect(cb.onSettled).toHaveBeenCalledTimes(1))
    expect(cb.order).toEqual(['result', 'settled'])
    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(loopNotes().at(-1)).toBe('loop: stopped, spawn failed')
    consoleError.mockRestore()
  })

  it('records blocked when the retry cannot start', async () => {
    mocks.precheck.mockResolvedValue(checkResult(1))
    prepareClaudeLaunch.mockImplementationOnce(async () => ({}) as never)
    prepareClaudeLaunch.mockImplementationOnce(async () => {
      throw new Error('sign-in expired')
    })
    const cb = callbacks()
    await start({ postcheck, ...cb })

    await vi.waitFor(() => expect(cb.onSettled).toHaveBeenCalledTimes(1))
    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(storedRuns()[0].outcome).toBe('blocked')
    expect(loopNotes().at(-1)).toBe('loop: blocked, the retry could not start (sign-in expired)')
    expect(cb.order).toEqual(['result', 'settled'])
  })

  it('never starts more than three runs, even if a caller forges the loop state', async () => {
    mocks.precheck.mockResolvedValue(checkResult(1))
    const cb = callbacks()
    await start({
      postcheck,
      ...cb,
      loop: { attempt: 1, rootRunId: 'root', maxRuns: 99, budgetCeilingUsd: 999, spentUsd: 0 }
    })

    await vi.waitFor(() => expect(cb.onSettled).toHaveBeenCalledTimes(1))
    expect(mocks.query).toHaveBeenCalledTimes(3)
    expect(storedRuns().at(-1)?.outcome).toBe('blocked')
  })
})
