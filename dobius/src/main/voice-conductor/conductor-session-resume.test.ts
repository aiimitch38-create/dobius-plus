import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  buildDobiusToolServer: vi.fn(),
  agentAllowedTools: [] as string[],
  runs: new Map<string, Record<string, unknown>>(),
  session: null as { sessionId: string; cwd: string } | null,
  // A fresh agent per test: session leases are module state.
  agentId: 'agent-0'
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mocks.query }))
vi.mock('../agents/agent-tools/dobius-tool-server', () => ({
  buildDobiusToolServer: mocks.buildDobiusToolServer
}))
vi.mock('../agents/agents-config-store', () => ({
  getAgentsControlState: () => ({
    paused: false,
    status: 'ok',
    detail: null,
    filePath: '/data/agents-config.json'
  })
}))
vi.mock('../agents/agents-store', () => ({
  getAgent: (id: string) => ({
    id,
    name: 'Voice Conductor',
    engine: 'claude',
    model: 'opus',
    allowedTools: ['Read'],
    skills: [],
    cwd: '/conductor',
    bypassPermissions: true
  }),
  getAgentSessionForKey: () => mocks.session,
  updateAgentSession: (_id: string, update: { lastSessionId: string; lastSessionCwd: string }) => {
    mocks.session = { sessionId: update.lastSessionId, cwd: update.lastSessionCwd }
  }
}))
vi.mock('../agents/agent-runs-store', () => ({
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
vi.mock('../agents/agent-run-events', () => ({
  broadcastRunEvent: vi.fn(),
  broadcastRunsChanged: vi.fn(),
  eventBase: (runId: string, agentId: string) => ({ runId, agentId, at: 0 }),
  reduceMessage: () => []
}))
vi.mock('../agents/agent-decision-queue', () => ({
  createAgentCanUseTool: vi.fn(),
  denyPendingDecisionsForRun: vi.fn(),
  setDecisionBypassRunHandler: vi.fn()
}))
vi.mock('../agents/agent-hard-rails', () => ({ buildAgentHardRailHooks: vi.fn(() => ({})) }))
vi.mock('../agents/agent-sandbox-context', () => ({
  resolveAgentRunSandboxPolicy: () => ({ sandbox: { enabled: true }, disallowedTools: [] })
}))
vi.mock('../agents/agent-notification-store', () => ({ appendAgentRunNotification: vi.fn() }))
vi.mock('../agents/agent-run-progress-log', () => ({ appendRunProgress: vi.fn() }))
vi.mock('../agents/agent-runner-environment', () => ({
  buildRunEnv: vi.fn(() => ({})),
  currentGitBranch: vi.fn(() => 'main'),
  resolveAgentRunCwd: (cwd: string) => cwd
}))
vi.mock('../agents/agent-run-prompt', () => ({ buildSystemPrompt: () => '' }))
vi.mock('../agents/default-codex-launch', () => ({ getDefaultPrepareCodexLaunch: () => () => null }))
vi.mock('../agents/codex-agent-execution', () => ({ startCodexAgentProcess: vi.fn() }))
vi.mock('../codex-cli/command', () => ({ resolveClaudeCommand: () => 'claude' }))

vi.mock('../agents/default-claude-launch', () => ({
  getDefaultPrepareClaudeLaunch: () => async () => ({})
}))
vi.mock('./conductor-agent', () => ({
  CONDUCTOR_ALLOWED_TOOLS: ['Read'],
  ensureConductorAgentId: () => mocks.agentId,
  ensureConductorDir: () => {}
}))

import { createVoiceConductor } from './conductor'

type ScriptedStream = { resume: string | undefined; finish(): void }

// Each SDK query announces a new session, then waits until the test finishes
// it (result) or the run is aborted (clean end, as after a stop).
function scriptSessions(): ScriptedStream[] {
  const streams: ScriptedStream[] = []
  mocks.query.mockImplementation(
    ({ options }: { options: { resume?: string; abortController: AbortController } }) => {
      let finish: () => void = () => {}
      const finished = new Promise<'result'>((resolve) => {
        finish = () => resolve('result')
      })
      const aborted = new Promise<'aborted'>((resolve) =>
        options.abortController.signal.addEventListener('abort', () => resolve('aborted'))
      )
      const sessionId = options.resume ?? `session-${streams.length + 1}`
      streams.push({ resume: options.resume, finish })
      async function* stream() {
        yield { type: 'system', subtype: 'init', session_id: sessionId }
        if ((await Promise.race([finished, aborted])) === 'result') {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: sessionId,
            result: 'ok',
            errors: [],
            num_turns: 1,
            total_cost_usd: 0
          }
        }
      }
      return Object.assign(stream(), { setPermissionMode: vi.fn(), interrupt: vi.fn(async () => {}) })
    }
  )
  return streams
}

beforeEach(() => {
  mocks.runs.clear()
  mocks.session = null
  mocks.agentId = `agent-${Math.random().toString(36).slice(2)}`
  mocks.query.mockReset()
})

describe('BUILD-036 F1: the next turn resumes the previous turn\'s session (real session lease)', () => {
  it('a queued turn resumes the session once the previous run has settled', async () => {
    const streams = scriptSessions()
    const conductor = createVoiceConductor()
    await conductor.start()

    await conductor.postTranscript({ requestId: 'req-1', transcript: 'one' })
    await vi.waitFor(() => expect(mocks.session?.sessionId).toBe('session-1'))
    await conductor.postTranscript({ requestId: 'req-2', transcript: 'two' })
    expect(streams).toHaveLength(1)

    streams[0].finish()

    await vi.waitFor(() => expect(streams).toHaveLength(2))
    expect(streams[1].resume).toBe('session-1')
  })

  it('a turn after a quick stop and restart resumes the stopped run\'s session', async () => {
    const streams = scriptSessions()
    const conductor = createVoiceConductor()
    await conductor.start()
    await conductor.postTranscript({ requestId: 'req-1', transcript: 'one' })
    await vi.waitFor(() => expect(mocks.session?.sessionId).toBe('session-1'))

    await conductor.stop()
    await conductor.start()
    await conductor.postTranscript({ requestId: 'req-2', transcript: 'two' })

    await vi.waitFor(() => expect(streams).toHaveLength(2))
    expect(streams[1].resume).toBe('session-1')
  })
})
