import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  buildDobiusToolServer: vi.fn(),
  agentAllowedTools: [] as string[],
  runs: new Map<string, Record<string, unknown>>()
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mocks.query }))
vi.mock('./agent-tools/dobius-tool-server', () => ({
  buildDobiusToolServer: mocks.buildDobiusToolServer
}))
vi.mock('./agents-config-store', () => ({
  getAgentsControlState: () => ({
    paused: false,
    status: 'ok',
    detail: null,
    filePath: '/data/agents-config.json'
  })
}))
vi.mock('./agents-store', () => ({
  getAgent: (id: string) => ({
    id,
    name: 'Atlas',
    engine: 'claude',
    model: 'claude-opus-4-8',
    allowedTools: mocks.agentAllowedTools,
    skills: [],
    cwd: '/repo',
    bypassPermissions: false
  }),
  getAgentSessionForKey: () => null,
  updateAgentSession: vi.fn()
}))
vi.mock('./agent-runs-store', () => ({
  addStoredAgentRun: (run: { id: string }) => mocks.runs.set(run.id, { ...run }),
  getStoredAgentRun: (id: string) => mocks.runs.get(id),
  listStoredAgentRuns: () => Array.from(mocks.runs.values()),
  updateStoredAgentRun: (id: string, updates: Record<string, unknown>) => {
    const run = mocks.runs.get(id)
    if (run) {
      Object.assign(run, updates)
    }
    return Boolean(run)
  }
}))
vi.mock('./agent-run-events', () => ({
  broadcastRunEvent: vi.fn(),
  broadcastRunsChanged: vi.fn(),
  eventBase: (runId: string, agentId: string) => ({ runId, agentId, at: 0 }),
  reduceMessage: () => []
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
  resolveAgentRunCwd: (cwd: string) => cwd,
  resolveAgentRunCwdPath: (cwd: string) => cwd
}))
vi.mock('./agent-run-prompt', () => ({ buildSystemPrompt: () => '' }))
vi.mock('./default-codex-launch', () => ({ getDefaultPrepareCodexLaunch: () => () => null }))
vi.mock('./codex-agent-execution', () => ({ startCodexAgentProcess: vi.fn() }))
vi.mock('../codex-cli/command', () => ({ resolveClaudeCommand: () => 'claude' }))

// Run admission (the ADAM handshake) is covered by agent-runner-adam-admission.test.ts;
// here it keeps only the pause checks, so no test reaches a real or fake ADAM.
vi.mock('./execution-gate', async (importOriginal) => {
  const actual = await importOriginal<{ assertExecutionAdmitted: (origin: string) => void }>()
  return {
    ...actual,
    assertRunAdmitted: vi.fn(async (origin: string) => {
      actual.assertExecutionAdmitted(origin)
      return undefined
    })
  }
})

import { startAgentRun, stopAgentRun } from './agent-runner'
import { appendAgentRunNotification } from './agent-notification-store'
import { claimRunSession, releaseRunSession } from './agent-session-lease'

// A stream that ends cleanly (no throw, no result) once the run is aborted.
function streamEndingOnAbort({ options }: { options: { abortController: AbortController } }) {
  return {
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
  }
}

beforeEach(() => {
  mocks.agentAllowedTools = ['Read']
  mocks.runs.clear()
  mocks.query.mockReset()
  mocks.query.mockImplementation(streamEndingOnAbort)
})

describe('BUILD-036: a stopped run always reports that it ended', () => {
  it('calls onRunEnded(cancelled) when the stream ends cleanly after a stop', async () => {
    const onRunEnded = vi.fn()
    const onResult = vi.fn()
    const runId = await startAgentRun({
      agentId: 'a',
      prompt: 'go',
      prepareClaudeLaunch: vi.fn(async () => ({}) as never),
      options: { source: 'channel', onRunEnded, onResult }
    })

    await stopAgentRun(runId)
    await vi.waitFor(() => expect(onRunEnded).toHaveBeenCalledWith('cancelled', 'stopped by user'))
    expect(onRunEnded).toHaveBeenCalledTimes(1)
    expect(onResult).not.toHaveBeenCalled()
    expect(mocks.runs.get(runId)?.status).toBe('cancelled')
  })
})

function streamWithResult() {
  async function* stream() {
    yield { type: 'system', subtype: 'init', session_id: 'session-1' }
    yield {
      type: 'result',
      subtype: 'success',
      session_id: 'session-1',
      result: 'ok',
      errors: [],
      num_turns: 1,
      total_cost_usd: 0
    }
  }
  return Object.assign(stream(), { setPermissionMode: vi.fn(), interrupt: vi.fn(async () => {}) })
}

describe('BUILD-036 review: end callbacks fire exactly once, then onSettled', () => {
  async function run(options: Parameters<typeof startAgentRun>[0]['options']) {
    mocks.query.mockImplementation(streamWithResult)
    const runId = await startAgentRun({
      agentId: 'a',
      prompt: 'go',
      prepareClaudeLaunch: vi.fn(async () => ({}) as never),
      options
    })
    return runId
  }

  it('a throwing onResult does not also fire onRunEnded', async () => {
    const onRunEnded = vi.fn()
    const onSettled = vi.fn()
    await run({
      source: 'channel',
      onResult: () => {
        throw new Error('caller bug')
      },
      onRunEnded,
      onSettled
    })
    await vi.waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1))
    expect(onRunEnded).not.toHaveBeenCalled()
  })

  it('a failed notification write does not turn a finished run into a second end', async () => {
    vi.mocked(appendAgentRunNotification).mockImplementationOnce(() => {
      throw new Error('notifications file unreadable')
    })
    const onResult = vi.fn()
    const onRunEnded = vi.fn()
    const onSettled = vi.fn()
    const runId = await run({ source: 'channel', onResult, onRunEnded, onSettled })
    await vi.waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1))
    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onRunEnded).not.toHaveBeenCalled()
    expect(mocks.runs.get(runId)?.status).toBe('success')
  })

  it('a stream error after the result does not fire a second end', async () => {
    mocks.query.mockImplementation(() => {
      const result = streamWithResult()
      async function* thenThrow() {
        yield* result
        throw new Error('transport closed')
      }
      return Object.assign(thenThrow(), { setPermissionMode: vi.fn(), interrupt: vi.fn(async () => {}) })
    })
    const onResult = vi.fn()
    const onRunEnded = vi.fn()
    const onSettled = vi.fn()
    await startAgentRun({
      agentId: 'a',
      prompt: 'go',
      prepareClaudeLaunch: vi.fn(async () => ({}) as never),
      options: { source: 'channel', onResult, onRunEnded, onSettled }
    })
    await vi.waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1))
    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onRunEnded).not.toHaveBeenCalled()
  })

  it('onSettled fires after the session lease is released', async () => {
    let keyFreeAtSettle: boolean | null = null
    const onSettled = vi.fn(() => {
      keyFreeAtSettle = claimRunSession('probe', 'a', 'default')
      releaseRunSession('probe')
    })
    await run({ source: 'channel', onResult: vi.fn(), onSettled })
    await vi.waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1))
    expect(keyFreeAtSettle).toBe(true)
  })
})

