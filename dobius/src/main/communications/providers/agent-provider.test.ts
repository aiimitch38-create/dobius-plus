import type { listAgentRuns } from '../../agents/agent-runner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  BrowserWindow: { getAllWindows: () => [] }
}))

vi.mock('electron', () => electronMock)

const runnerMock = vi.hoisted(() => ({
  startAgentRun: vi.fn(),
  stopAgentRun: vi.fn(),
  listAgentRuns: vi.fn(() => [] as Awaited<ReturnType<typeof listAgentRuns>>)
}))

vi.mock('../../agents/agent-runner', () => runnerMock)

const agentsStoreMock = vi.hoisted(() => ({
  getAgent: vi.fn()
}))

vi.mock('../../agents/agents-store', () => agentsStoreMock)

const identityStoreMock = vi.hoisted(() => ({
  ensureAgentIdentity: vi.fn()
}))

vi.mock('../agent-participant-identity-store', () => identityStoreMock)

import { broadcastRunEvent } from '../../agents/agent-run-events'
import type { AgentRun, CustomAgent } from '../../../shared/agents'
import { ClaudeAgentSdkProvider } from './claude-agent-sdk-provider'
import { CodexCliProvider } from './codex-cli-provider'

function makeAgent(overrides: Partial<CustomAgent> = {}): CustomAgent {
  return {
    id: 'agent-1',
    name: 'Scout',
    description: '',
    icon: 'bot',
    color: '#7aa2f7',
    systemPrompt: '',
    engine: 'claude',
    model: '',
    allowedTools: [],
    skills: [],
    cwd: '',
    bypassPermissions: false,
    heartbeat: {
      enabled: false,
      frequency: 'daily',
      at: '09:00',
      quietStart: '',
      quietEnd: '',
      maxBudgetUsd: 1,
      maxTurns: 10
    },
    notify: 'urgent only',
    channels: { imessage: false },
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  }
}

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-1',
    agentId: 'agent-1',
    prompt: 'hi',
    startedAt: 0,
    status: 'running',
    ...overrides
  }
}

const noopPrepareClaudeLaunch = async () => {
  throw new Error('not used in test')
}

beforeEach(() => {
  vi.clearAllMocks()
  agentsStoreMock.getAgent.mockReturnValue(makeAgent())
  identityStoreMock.ensureAgentIdentity.mockReturnValue({ pubkey: 'agent-pubkey-hex' })
})

describe('runner-backed agent providers', () => {
  it('launch delegates to startAgentRun and binds the Nostr identity', async () => {
    runnerMock.startAgentRun.mockResolvedValue('run-1')
    const provider = new ClaudeAgentSdkProvider('agent-1', noopPrepareClaudeLaunch)

    const result = await provider.launch({ agentId: 'agent-1', prompt: 'hello', cwd: '/tmp/w' })

    expect(result).toEqual({ runId: 'run-1', identityPubkey: 'agent-pubkey-hex' })
    expect(identityStoreMock.ensureAgentIdentity).toHaveBeenCalledWith('agent-1')
    expect(runnerMock.startAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        prompt: 'hello',
        cwd: '/tmp/w',
        options: { source: 'channel' }
      })
    )
  })

  it('claude provider refuses codex-engine agents so routing stays exact', async () => {
    agentsStoreMock.getAgent.mockReturnValue(makeAgent({ engine: 'codex' }))
    const provider = new ClaudeAgentSdkProvider('agent-1', noopPrepareClaudeLaunch)

    await expect(provider.launch({ agentId: 'agent-1', prompt: 'hi' })).rejects.toThrow(
      /not a Claude agent/
    )
    expect(runnerMock.startAgentRun).not.toHaveBeenCalled()
  })

  it('codex provider launches through the same runner seam', async () => {
    agentsStoreMock.getAgent.mockReturnValue(makeAgent({ engine: 'codex' }))
    runnerMock.startAgentRun.mockResolvedValue('run-9')
    const prepareCodexLaunch = vi.fn(() => '/tmp/codex-home')
    const provider = new CodexCliProvider('agent-1', prepareCodexLaunch)

    const result = await provider.launch({ agentId: 'agent-1', prompt: 'hi' })

    expect(result.runId).toBe('run-9')
    expect(runnerMock.startAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        prepareCodexLaunch,
        options: { source: 'channel' }
      })
    )
  })

  it('codex provider refuses claude-engine agents', async () => {
    const provider = new CodexCliProvider('agent-1')

    await expect(provider.launch({ agentId: 'agent-1', prompt: 'hi' })).rejects.toThrow(
      /not a Codex agent/
    )
  })

  it('send delivers a trimmed follow-up turn as another channel run', async () => {
    const provider = new ClaudeAgentSdkProvider('agent-1', noopPrepareClaudeLaunch)

    await provider.send('  follow up  ')

    expect(runnerMock.startAgentRun).toHaveBeenLastCalledWith(
      expect.objectContaining({ prompt: 'follow up', options: { source: 'channel' } })
    )
  })

  it('send rejects an empty prompt', async () => {
    const provider = new ClaudeAgentSdkProvider('agent-1', noopPrepareClaudeLaunch)

    await expect(provider.send('   ')).rejects.toThrow('Prompt is required')
  })

  it('subscribe streams only this agent’s run events until unsubscribed', async () => {
    const provider = new ClaudeAgentSdkProvider('agent-1', noopPrepareClaudeLaunch)
    const seen: string[] = []
    const unsubscribe = provider.subscribe((event) => {
      if (event.kind === 'run-event') {
        seen.push(event.event.text ?? '')
      }
    })

    broadcastRunEvent({
      runId: 'run-1',
      agentId: 'agent-1',
      ts: 1,
      kind: 'assistant-text',
      text: 'mine'
    })
    broadcastRunEvent({
      runId: 'run-2',
      agentId: 'other-agent',
      ts: 2,
      kind: 'assistant-text',
      text: 'theirs'
    })
    unsubscribe()
    broadcastRunEvent({
      runId: 'run-3',
      agentId: 'agent-1',
      ts: 3,
      kind: 'assistant-text',
      text: 'late'
    })

    expect(seen).toEqual(['mine'])
  })

  it('cancel stops the currently running run', async () => {
    runnerMock.listAgentRuns.mockReturnValue([makeRun()])
    const provider = new ClaudeAgentSdkProvider('agent-1', noopPrepareClaudeLaunch)

    await provider.cancel()

    expect(runnerMock.stopAgentRun).toHaveBeenCalledWith('run-1')
  })

  it('status derives its state from the stored runs', () => {
    runnerMock.listAgentRuns.mockReturnValue([
      makeRun({ status: 'success', summary: 'done', endedAt: 5 })
    ])
    const provider = new ClaudeAgentSdkProvider('agent-1', noopPrepareClaudeLaunch)

    expect(provider.status()).toEqual({
      providerId: 'claude-agent-sdk',
      agentId: 'agent-1',
      label: 'Scout',
      state: 'finished',
      lastRunId: 'run-1',
      detail: 'done'
    })
  })

  it('status reports failed after an errored run', () => {
    runnerMock.listAgentRuns.mockReturnValue([makeRun({ status: 'error', summary: 'boom' })])
    const provider = new CodexCliProvider('agent-1')

    expect(provider.status().state).toBe('failed')
  })
})
