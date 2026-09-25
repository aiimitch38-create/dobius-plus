import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  buildDobiusToolServer: vi.fn(),
  agentAllowedTools: [] as string[]
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
  addStoredAgentRun: vi.fn(),
  getStoredAgentRun: vi.fn(),
  listStoredAgentRuns: () => [],
  updateStoredAgentRun: vi.fn(() => true)
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

import { startAgentRun } from './agent-runner'
import { buildAgentHardRailHooks } from './agent-hard-rails'

type CapturedOptions = {
  allowedTools: string[]
  tools?: string[]
  mcpServers: Record<
    string,
    { context?: { tools: string[]; buildLane?: string; asanaTaskGid?: string } }
  >
}

function pendingQuery() {
  return {
    [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
    setPermissionMode: vi.fn(),
    interrupt: vi.fn()
  }
}

const prepareClaudeLaunch = vi.fn(async () => ({}) as never)

async function launch(options: Parameters<typeof startAgentRun>[0]['options']) {
  // Each launch holds a slot (the query never ends); one launch here.
  await startAgentRun({ agentId: 'a', prompt: 'go', prepareClaudeLaunch, options })
  const captured = mocks.query.mock.calls.at(-1)?.at(0) as { options: CapturedOptions }
  return captured.options
}

beforeEach(() => {
  mocks.agentAllowedTools = ['Read', 'Grep', 'Glob']
  mocks.query.mockReset()
  mocks.query.mockImplementation(pendingQuery)
  mocks.buildDobiusToolServer.mockReset()
  mocks.buildDobiusToolServer.mockImplementation((context: unknown) => ({ context }))
})

describe('BUILD-033 F3: conductor-spawned runs get the conductor rails', () => {
  it('passes spawnedBy from the run options to the hard rails', async () => {
    await launch({ source: 'channel', spawnedBy: 'voice-conductor' })
    expect(vi.mocked(buildAgentHardRailHooks)).toHaveBeenLastCalledWith({
      agentId: 'a',
      profile: 'channel',
      spawnedBy: 'voice-conductor'
    })
  })
})
