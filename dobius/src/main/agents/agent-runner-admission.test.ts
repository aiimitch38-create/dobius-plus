import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  paused: false,
  query: vi.fn(),
  startCodexAgentProcess: vi.fn(),
  addStoredAgentRun: vi.fn(),
  engine: 'claude' as 'claude' | 'codex'
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mocks.query }))
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
    allowedTools: [],
    skills: [],
    cwd: '/repo',
    bypassPermissions: false
  }),
  getAgentSessionForKey: () => null,
  updateAgentSession: vi.fn()
}))
vi.mock('./agent-runs-store', () => ({
  addStoredAgentRun: mocks.addStoredAgentRun,
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
vi.mock('./agent-sandbox-policy', () => ({
  resolveAgentRunSandboxPolicy: () => ({ sandbox: { enabled: true }, disallowedTools: [] })
}))
vi.mock('./agent-notification-store', () => ({ appendAgentRunNotification: vi.fn() }))
vi.mock('./agent-run-progress-log', () => ({ appendRunProgress: vi.fn() }))
vi.mock('./agent-runner-environment', () => ({
  buildRunEnv: vi.fn(() => ({})),
  currentGitBranch: vi.fn(() => 'main'),
  resolveAgentRunCwd: (cwd: string) => cwd
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

import { startAgentRun } from './agent-runner'

// A query that never finishes keeps each admitted run holding its slot.
function pendingQuery() {
  return {
    [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
    setPermissionMode: vi.fn(),
    interrupt: vi.fn()
  }
}

const prepareClaudeLaunch = vi.fn(async () => ({}) as never)

beforeEach(() => {
  mocks.paused = false
  mocks.engine = 'claude'
  mocks.query.mockReset()
  mocks.query.mockImplementation(pendingQuery)
  mocks.startCodexAgentProcess.mockReset()
  mocks.addStoredAgentRun.mockReset()
  prepareClaudeLaunch.mockReset()
  prepareClaudeLaunch.mockImplementation(async () => ({}) as never)
})

describe('startAgentRun admission', () => {
  it('refuses an autonomous run while paused without storing a run', async () => {
    mocks.paused = true
    await expect(
      startAgentRun({ agentId: 'a', prompt: 'go', prepareClaudeLaunch })
    ).rejects.toMatchObject({ name: 'ExecutionBlockedError' })
    expect(mocks.query).not.toHaveBeenCalled()
    expect(prepareClaudeLaunch).not.toHaveBeenCalled()
    expect(mocks.addStoredAgentRun).not.toHaveBeenCalled()
  })

  it('refuses a Codex agent while paused', async () => {
    mocks.paused = true
    mocks.engine = 'codex'
    await expect(
      startAgentRun({ agentId: 'a', prompt: 'go', prepareClaudeLaunch })
    ).rejects.toMatchObject({ name: 'ExecutionBlockedError' })
    expect(mocks.startCodexAgentProcess).not.toHaveBeenCalled()
  })

  it('lets a human run from the Agents page while paused', async () => {
    mocks.paused = true
    await startAgentRun({
      agentId: 'page',
      prompt: 'go',
      prepareClaudeLaunch,
      options: { origin: 'agents-page' }
    })
    expect(mocks.query).toHaveBeenCalledTimes(1)
  })

  it('re-checks after auth preparation and releases the slot, so no slots leak', async () => {
    prepareClaudeLaunch.mockImplementation(async () => {
      mocks.paused = true
      return {} as never
    })
    for (let i = 0; i < 9; i += 1) {
      mocks.paused = false
      await expect(
        startAgentRun({ agentId: `race-${i}`, prompt: 'go', prepareClaudeLaunch })
      ).rejects.toMatchObject({ name: 'ExecutionBlockedError' })
    }
    expect(mocks.query).not.toHaveBeenCalled()
    expect(mocks.addStoredAgentRun).not.toHaveBeenCalled()

    // One slot is already held by the Agents-page run above; 7 more must still fit under the cap of 8.
    mocks.paused = false
    prepareClaudeLaunch.mockImplementation(async () => ({}) as never)
    for (let i = 0; i < 7; i += 1) {
      await startAgentRun({ agentId: `ok-${i}`, prompt: 'go', prepareClaudeLaunch })
    }
    expect(mocks.query).toHaveBeenCalledTimes(7)
  })
})
