import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CHANNEL_AGENT_BASELINE_TOOLS } from '../../shared/agents'

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

type CapturedOptions = {
  allowedTools: string[]
  tools?: string[]
  mcpServers: Record<string, { context?: { tools: string[]; buildLane?: string } }>
}

const CREW = [
  'mcp__dobius__asana_draft_comment',
  'mcp__dobius__read_knowledge',
  'mcp__dobius__list_crew',
  'mcp__dobius__crew_status',
  'mcp__dobius__file_briefing_item'
]

function pendingQuery() {
  return {
    [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
    setPermissionMode: vi.fn(),
    interrupt: vi.fn()
  }
}

const prepareClaudeLaunch = vi.fn(async () => ({}) as never)

async function launch(options: Parameters<typeof startAgentRun>[0]['options']) {
  // Each launch holds a slot (the query never ends); this file stays under the cap of 8.
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

describe('startAgentRun tool profiles (SDK query arguments)', () => {
  it('manual run: agent allowlist + crew tools, no wildcard, SDK default built-ins', async () => {
    mocks.agentAllowedTools = ['Read', 'mcp__dobius__*']
    const options = await launch(undefined)
    expect(options.allowedTools).toEqual(['Read', ...CREW])
    expect(options.allowedTools).not.toContain('mcp__dobius__*')
    expect(options.tools).toBeUndefined()
    expect(options.mcpServers.dobius.context?.tools).not.toContain('dispatch_build')
  })

  it('heartbeat run: exactly the crew tools, no dispatch_build', async () => {
    const options = await launch({ source: 'heartbeat' })
    expect(options.allowedTools).toEqual(['Read', 'Grep', 'Glob', ...CREW])
    expect(options.mcpServers.dobius.context?.tools).toEqual(
      CREW.map((tool) => tool.replace('mcp__dobius__', ''))
    )
  })

  it('build-lane triage: explicit empty built-ins, dobius tools incl. dispatch_build', async () => {
    const options = await launch({ source: 'asana', asanaLane: 'build', allowedTools: [] })
    expect(options.tools).toEqual([])
    expect(options.allowedTools).toEqual([
      'mcp__dobius__file_briefing_item',
      'mcp__dobius__asana_draft_comment',
      'mcp__dobius__read_knowledge',
      'mcp__dobius__dispatch_build'
    ])
    expect(options.mcpServers.dobius.context?.buildLane).toBe('build')
  })

  it('review-lane triage: no dispatch_build anywhere', async () => {
    const options = await launch({ source: 'asana', asanaLane: 'review', allowedTools: [] })
    expect(options.allowedTools).not.toContain('mcp__dobius__dispatch_build')
    expect(options.mcpServers.dobius.context?.tools).not.toContain('dispatch_build')
  })

  it('never passes MCP wildcards or permission rules as SDK built-in tool names', async () => {
    const legacy = await launch({ source: 'asana', allowedTools: ['mcp__dobius__*'] })
    expect(legacy.tools).toEqual([])

    const channel = await launch({
      source: 'channel',
      allowedTools: ['Read', 'Bash(git status:*)', 'mcp__playwright__*']
    })
    // Availability = the caller's explicit built-ins only; the baseline is approval, not availability.
    expect(channel.tools).toEqual(['Read', 'Bash'])
    expect(channel.allowedTools).toEqual(
      expect.arrayContaining([...CHANNEL_AGENT_BASELINE_TOOLS, 'mcp__dobius__post_channel_message'])
    )
  })

  it('voice conductor: only its own tools — no channel baseline, no dobius server', async () => {
    const conductorTools = [
      'Bash',
      'Read',
      'Edit',
      'Write',
      'Glob',
      'Grep',
      'WebFetch',
      'WebSearch'
    ]
    const options = await launch({
      source: 'channel',
      profile: 'voice-conductor',
      allowedTools: conductorTools
    })
    expect(options.allowedTools).toEqual(conductorTools)
    expect(options.tools).toEqual(conductorTools)
    expect(options.mcpServers).toEqual({})
    expect(mocks.buildDobiusToolServer).not.toHaveBeenCalled()
  })
})
