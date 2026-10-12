import { describe, expect, it, vi } from 'vitest'
import { IMESSAGE_SESSION_KEY, type CustomAgent } from '../../shared/agents'
import { handleChannelMessage, matchAgentMention } from './agent-channel-service'
import { CodexRunUnsupportedError } from './codex-run-policy'
import { ExecutionBlockedError } from './execution-gate'

const mocks = vi.hoisted(() => ({
  agents: [] as CustomAgent[],
  startAgentRun: vi.fn()
}))

vi.mock('./agents-store', () => ({ listAgents: () => mocks.agents }))
vi.mock('./agent-runner', () => ({ startAgentRun: mocks.startAgentRun }))

function agent(overrides: Partial<CustomAgent>): CustomAgent {
  return {
    id: overrides.id ?? overrides.name ?? 'agent',
    name: overrides.name ?? 'Auditor',
    description: '',
    icon: 'bot',
    color: '#b9bcc2',
    systemPrompt: '',
    model: 'claude-opus-4-8',
    allowedTools: ['Read', 'Grep', 'Glob'],
    cwd: '',
    bypassPermissions: false,
    heartbeat: {
      enabled: false,
      frequency: 'daily',
      at: '08:00',
      quietStart: '23:00',
      quietEnd: '08:00',
      maxBudgetUsd: 0.5,
      maxTurns: 25
    },
    notify: 'digest + urgent',
    channels: { imessage: true },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
    skills: overrides.skills ?? []
  }
}

describe('matchAgentMention', () => {
  it('matches @Auditor with an ask', () => {
    expect(
      matchAgentMention('@Auditor check the diff', [agent({ name: 'Auditor' })])
    ).toMatchObject({
      agent: { name: 'Auditor' },
      ask: 'check the diff'
    })
  })

  it('matches case-insensitively', () => {
    expect(matchAgentMention('@auditor check', [agent({ name: 'Auditor' })])).toMatchObject({
      agent: { name: 'Auditor' },
      ask: 'check'
    })
  })

  it('matches spaced names and compact aliases', () => {
    const sentry = agent({ name: 'Sentry Watch' })
    expect(matchAgentMention('@Sentry Watch check errors', [sentry])).toMatchObject({
      agent: { name: 'Sentry Watch' },
      ask: 'check errors'
    })
    expect(matchAgentMention('@sentrywatch', [sentry])).toMatchObject({
      agent: { name: 'Sentry Watch' },
      ask: 'Report your current status briefly.'
    })
  })

  it('returns null for non-mentions', () => {
    expect(matchAgentMention('Auditor check', [agent({ name: 'Auditor' })])).toBeNull()
  })

  it('returns unknown-mention for missing eligible agents', () => {
    expect(matchAgentMention('@nobody check', [agent({ name: 'Auditor' })])).toBe('unknown-mention')
  })

  it('does not match agents without iMessage enabled', () => {
    expect(
      matchAgentMention('@Auditor check', [
        agent({ name: 'Auditor', channels: { imessage: false } })
      ])
    ).toBe('unknown-mention')
  })
})

describe('handleChannelMessage start errors', () => {
  async function replyFor(error: Error): Promise<string> {
    mocks.agents = [agent({ name: 'Auditor' })]
    mocks.startAgentRun.mockReset()
    mocks.startAgentRun.mockRejectedValue(error)
    const sendReply = vi.fn(async () => {})
    await handleChannelMessage({
      text: '@Auditor check',
      replyHandle: 'me',
      prepareClaudeLaunch: vi.fn(),
      sendReply
    })
    return String(sendReply.mock.calls.at(0)?.at(0))
  }

  it('tells the phone the crew is paused when the gate blocks the run', async () => {
    const reply = await replyFor(new ExecutionBlockedError('agent-run', 'paused', 'paused'))
    expect(reply).toContain('paused')
    expect(reply).not.toContain('busy')
  })

  it('tells the phone a Codex agent cannot answer iMessage instead of saying busy', async () => {
    const reply = await replyFor(
      new CodexRunUnsupportedError("Codex agents cannot run the 'imessage' profile.")
    )
    expect(reply).toBe("Auditor runs on Codex and can't answer iMessage.")
  })

  it('keeps the busy reply for other start errors', async () => {
    expect(await replyFor(new Error('Too many concurrent agent runs'))).toContain('busy')
  })
})

describe('handleChannelMessage tool profile', () => {
  it('starts iMessage runs on the read-only imessage profile', async () => {
    mocks.agents = [agent({ name: 'Auditor' })]
    mocks.startAgentRun.mockReset()
    mocks.startAgentRun.mockResolvedValue('run-1')
    await handleChannelMessage({
      text: '@Auditor check',
      replyHandle: 'me',
      prepareClaudeLaunch: vi.fn(),
      sendReply: vi.fn(async () => {})
    })
    expect(mocks.startAgentRun.mock.calls[0][0].options).toMatchObject({
      source: 'channel',
      profile: 'imessage'
    })
  })

  it('runs iMessage asks on their own session key, never the manual default (N2)', async () => {
    mocks.agents = [agent({ name: 'Auditor' })]
    mocks.startAgentRun.mockReset()
    mocks.startAgentRun.mockResolvedValue('run-1')
    await handleChannelMessage({
      text: '@Auditor check',
      replyHandle: 'me',
      prepareClaudeLaunch: vi.fn(),
      sendReply: vi.fn(async () => {})
    })
    const options = mocks.startAgentRun.mock.calls[0][0].options
    expect(options.sessionKey).toBe(IMESSAGE_SESSION_KEY)
    expect(IMESSAGE_SESSION_KEY).not.toBe('default')
    expect(options.resume).toBe(false)
  })
})
