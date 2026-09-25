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
vi.mock('./agent-notification-store', () => ({ appendAgentRunNotification: vi.fn() }))
vi.mock('./agent-run-progress-log', () => ({ appendRunProgress: vi.fn() }))
vi.mock('./agent-runner-environment', () => ({
  buildRunEnv: vi.fn(() => ({})),
  currentGitBranch: vi.fn(() => 'main'),
  resolveAgentRunCwd: (cwd: string) => cwd
}))
vi.mock('./agent-run-prompt', () => ({ buildSystemPrompt: () => '' }))
vi.mock('./default-codex-launch', () => ({ getDefaultPrepareCodexLaunch: () => () => null }))
vi.mock('./codex-agent-execution', () => ({ startCodexAgentProcess: vi.fn() }))
vi.mock('../codex-cli/command', () => ({ resolveClaudeCommand: () => 'claude' }))

import { startAgentRun, stopAgentRun } from './agent-runner'

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
