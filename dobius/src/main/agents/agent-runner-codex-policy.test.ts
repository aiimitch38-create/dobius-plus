import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentRun } from '../../shared/agents'

type CodexFinish = (status: 'success' | 'error' | 'cancelled', summary: string) => void

const mocks = vi.hoisted(() => ({
  runs: new Map<string, AgentRun>(),
  startCodexAgentProcess: vi.fn(),
  appendAgentRunNotification: vi.fn(),
  kill: vi.fn()
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }))
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
    name: 'Edith',
    engine: 'codex',
    model: 'gpt-5-codex',
    allowedTools: [],
    skills: [],
    cwd: '/repo',
    bypassPermissions: false
  }),
  getAgentSessionForKey: () => null,
  updateAgentSession: vi.fn()
}))
vi.mock('./agent-runs-store', () => ({
  addStoredAgentRun: (run: AgentRun) => mocks.runs.set(run.id, { ...run }),
  getStoredAgentRun: (id: string) => mocks.runs.get(id),
  listStoredAgentRuns: () => [...mocks.runs.values()],
  updateStoredAgentRun: (id: string, updates: Partial<AgentRun>) => {
    const run = mocks.runs.get(id)
    if (!run) {
      return false
    }
    mocks.runs.set(id, { ...run, ...updates })
    return true
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
vi.mock('./agent-notification-store', () => ({
  appendAgentRunNotification: mocks.appendAgentRunNotification
}))
vi.mock('./agent-run-progress-log', () => ({ appendRunProgress: vi.fn() }))
vi.mock('./agent-runner-environment', () => ({
  buildRunEnv: vi.fn(() => ({})),
  currentGitBranch: vi.fn(() => 'main'),
  resolveAgentRunCwd: (cwd: string) => cwd,
  resolveAgentRunCwdPath: (cwd: string) => cwd
}))
vi.mock('./agent-run-prompt', () => ({ buildSystemPrompt: () => '' }))
vi.mock('./default-codex-launch', () => ({ getDefaultPrepareCodexLaunch: () => () => null }))
vi.mock('./codex-agent-execution', () => ({
  startCodexAgentProcess: mocks.startCodexAgentProcess
}))
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

import { hasLiveAgentRun, startAgentRun, stopAgentRun } from './agent-runner'

const prepareClaudeLaunch = vi.fn(async () => {
  throw new Error('Codex runs do not use Claude account preparation')
})

function lastFinish(): CodexFinish {
  const call = mocks.startCodexAgentProcess.mock.calls.at(-1)?.[0] as { onFinish: CodexFinish }
  return call.onFinish
}

// Fills every slot, proving that nothing leaked, then settles them all.
async function expectAllSlotsFree(): Promise<void> {
  const finishes: CodexFinish[] = []
  for (let i = 0; i < 8; i += 1) {
    await startAgentRun({ agentId: `free-${i}`, prompt: 'go', prepareClaudeLaunch })
    finishes.push(lastFinish())
  }
  await expect(
    startAgentRun({ agentId: 'over', prompt: 'go', prepareClaudeLaunch })
  ).rejects.toThrow('Too many concurrent agent runs')
  for (const finish of finishes) {
    finish('success', 'ok')
  }
}

beforeEach(() => {
  mocks.runs.clear()
  mocks.startCodexAgentProcess.mockReset()
  mocks.startCodexAgentProcess.mockImplementation(() => ({ kill: mocks.kill }))
  mocks.appendAgentRunNotification.mockReset()
  mocks.kill.mockReset()
})

describe('Codex engine run policy', () => {
  it.each([
    ['heartbeat', { source: 'heartbeat' as const }],
    ['channel', { source: 'channel' as const }],
    ['asana', { source: 'asana' as const, asanaLane: 'build' as const, asanaTaskGid: '42' }],
    ['imessage', { source: 'channel' as const, profile: 'imessage' as const }],
    ['voice-conductor', { source: 'channel' as const, profile: 'voice-conductor' as const }]
  ])(
    'rejects the restricted %s profile before reserving a slot or spawning',
    async (_, options) => {
      await expect(
        startAgentRun({ agentId: 'edith', prompt: 'go', prepareClaudeLaunch, options })
      ).rejects.toMatchObject({ name: 'CodexRunUnsupportedError' })
      expect(mocks.startCodexAgentProcess).not.toHaveBeenCalled()
      expect(mocks.runs.size).toBe(0)
      expect(hasLiveAgentRun('edith')).toBe(false)
    }
  )

  it.each([
    ['a tool allowlist', { allowedTools: [] }],
    ['a permission mode', { permissionMode: 'dontAsk' as const }],
    ['a dollar budget', { maxBudgetUsd: 0.3 }],
    ['a structured output', { outputFormat: { type: 'json_schema' as const, schema: {} } }],
    ['a result callback', { onResult: vi.fn() }]
  ])('rejects a manual run that needs %s Codex cannot enforce', async (_, options) => {
    await expect(
      startAgentRun({ agentId: 'edith', prompt: 'go', prepareClaudeLaunch, options })
    ).rejects.toMatchObject({ name: 'CodexRunUnsupportedError' })
    expect(mocks.startCodexAgentProcess).not.toHaveBeenCalled()
    expect(mocks.runs.size).toBe(0)
  })

  it('leaks no slot across rejected runs', async () => {
    for (let i = 0; i < 9; i += 1) {
      await expect(
        startAgentRun({
          agentId: `hb-${i}`,
          prompt: 'go',
          prepareClaudeLaunch,
          options: { source: 'heartbeat', model: 'claude-haiku-4-5' }
        })
      ).rejects.toMatchObject({ name: 'CodexRunUnsupportedError' })
    }
    await expectAllSlotsFree()
  })

  it('passes the turn cap and model override to Codex, defaulting to 100 steps', async () => {
    await startAgentRun({ agentId: 'edith', prompt: 'go', prepareClaudeLaunch })
    expect(mocks.startCodexAgentProcess.mock.calls[0]?.[0]).toMatchObject({ maxSteps: 100 })
    lastFinish()('success', 'ok')

    await startAgentRun({
      agentId: 'edith',
      prompt: 'go',
      prepareClaudeLaunch,
      options: { maxTurns: 7, model: 'gpt-5-mini' }
    })
    expect(mocks.startCodexAgentProcess.mock.calls[1]?.[0]).toMatchObject({
      maxSteps: 7,
      model: 'gpt-5-mini'
    })
    lastFinish()('success', 'ok')
  })
})

describe('Codex run finalizer', () => {
  it.each(['success', 'error'] as const)(
    'settles a %s run exactly once and frees its slot',
    async (status) => {
      const onRunEnded = vi.fn()
      const runId = await startAgentRun({
        agentId: 'edith',
        prompt: 'go',
        prepareClaudeLaunch,
        options: { onRunEnded }
      })
      const finish = lastFinish()
      finish(status, 'first')
      finish(status, 'second')
      expect(mocks.runs.get(runId)).toMatchObject({ status, summary: 'first' })
      expect(mocks.appendAgentRunNotification).toHaveBeenCalledTimes(1)
      expect(onRunEnded.mock.calls).toEqual(status === 'error' ? [['error', 'first']] : [])
      expect(hasLiveAgentRun('edith')).toBe(false)
      await expectAllSlotsFree()
    }
  )

  it('settles a cancelled run exactly once and frees its slot', async () => {
    const onRunEnded = vi.fn()
    const runId = await startAgentRun({
      agentId: 'edith',
      prompt: 'go',
      prepareClaudeLaunch,
      options: { onRunEnded }
    })
    await stopAgentRun(runId)
    expect(mocks.kill).toHaveBeenCalledWith('SIGTERM')
    const finish = lastFinish()
    finish('cancelled', 'stopped by user')
    finish('error', 'late close')
    expect(mocks.runs.get(runId)?.status).toBe('cancelled')
    expect(onRunEnded.mock.calls).toEqual([['cancelled', 'stopped by user']])
    expect(hasLiveAgentRun('edith')).toBe(false)
    await expectAllSlotsFree()
  })
})
