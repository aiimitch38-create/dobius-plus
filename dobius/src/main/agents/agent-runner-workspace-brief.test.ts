import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  paused: false,
  query: vi.fn(),
  startCodexAgentProcess: vi.fn(),
  addStoredAgentRun: vi.fn(),
  engine: 'claude' as 'claude' | 'codex',
  refreshBrief: vi.fn()
}))

vi.mock('./session-workspace-brief', () => ({
  scheduleSessionWorkspaceBriefRefresh: mocks.refreshBrief
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
  mocks.addStoredAgentRun.mockReset()
  mocks.refreshBrief.mockReset()
  mocks.refreshBrief.mockResolvedValue({ status: 'written', filePath: '/repo/CLAUDE.local.md' })
})

describe('startAgentRun workspace brief (BUILD-050)', () => {
  it('schedules the brief for the resolved cwd without waiting on it', async () => {
    // A refresh that never settles must not hold the run back (SDK runs do not read the file).
    mocks.refreshBrief.mockImplementation(() => new Promise(() => {}))

    await startAgentRun({ agentId: 'a', prompt: 'go', cwd: '/work/tree', prepareClaudeLaunch })

    expect(mocks.refreshBrief).toHaveBeenCalledWith('/work/tree')
    expect(mocks.query).toHaveBeenCalledTimes(1)
  })

  it('does not touch the worktree for a run refused by Pause crew', async () => {
    prepareClaudeLaunch.mockImplementationOnce(async () => {
      mocks.paused = true
      return {} as never
    })

    await expect(
      startAgentRun({ agentId: 'a', prompt: 'go', prepareClaudeLaunch })
    ).rejects.toMatchObject({ name: 'ExecutionBlockedError' })
    expect(mocks.refreshBrief).not.toHaveBeenCalled()
    expect(mocks.query).not.toHaveBeenCalled()
  })
})
