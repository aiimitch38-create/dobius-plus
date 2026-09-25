import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentRun } from '../../shared/agents'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  runs: [] as AgentRun[],
  updateAgentSession: vi.fn()
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mocks.query }))
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
    allowedTools: [],
    skills: [],
    cwd: '/repo',
    bypassPermissions: false
  }),
  getAgentSessionForKey: (_agent: unknown, key: string) => ({
    sessionId: `s-${key}`,
    cwd: '/repo'
  }),
  updateAgentSession: mocks.updateAgentSession
}))
// A faithful in-memory run store: the old busy check read it, so the race
// test only proves something if running runs really show up here.
vi.mock('./agent-runs-store', () => ({
  addStoredAgentRun: (run: AgentRun) => {
    mocks.runs.push({ ...run })
    return mocks.runs
  },
  getStoredAgentRun: (id: string) => {
    const run = mocks.runs.find((entry) => entry.id === id)
    return run ? { ...run } : null
  },
  listStoredAgentRuns: () => mocks.runs.map((run) => ({ ...run })),
  updateStoredAgentRun: (id: string, updates: Partial<AgentRun>) => {
    const run = mocks.runs.find((entry) => entry.id === id)
    if (!run) {
      return null
    }
    Object.assign(run, updates)
    return { ...run }
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
vi.mock('./agent-runner-dobius-tools', () => ({
  buildDobiusRunMcpServer: vi.fn(() => ({})),
  buildProfileAllowedTools: (_profile: unknown, tools: string[]) => tools,
  builtInToolsFor: () => undefined,
  resolveAgentRunProfile: () => ({ id: 'manual', dobiusTools: [], channelBaseline: false })
}))
vi.mock('./agent-run-prompt', () => ({ buildSystemPrompt: () => '' }))
vi.mock('./default-codex-launch', () => ({ getDefaultPrepareCodexLaunch: () => () => null }))
vi.mock('./codex-agent-execution', () => ({ startCodexAgentProcess: vi.fn() }))
vi.mock('../codex-cli/command', () => ({ resolveClaudeCommand: () => 'claude' }))

import { startAgentRun } from './agent-runner'
import { invalidateAgentSessions } from './agent-session-lease'

type Message = Record<string, unknown>

// A query whose messages the test pushes by hand; end() closes the stream.
function controllableQuery() {
  const queue: Message[] = []
  let wake: (() => void) | null = null
  let ended = false
  const iterator = {
    next: async (): Promise<IteratorResult<Message>> => {
      while (queue.length === 0 && !ended) {
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
      const value = queue.shift()
      return value ? { value, done: false } : { value: undefined, done: true }
    }
  }
  const poke = (): void => {
    const resolve = wake
    wake = null
    resolve?.()
  }
  return {
    handle: {
      [Symbol.asyncIterator]: () => iterator,
      setPermissionMode: vi.fn(),
      interrupt: vi.fn()
    },
    push: (message: Message) => {
      queue.push(message)
      poke()
    },
    end: () => {
      ended = true
      poke()
    }
  }
}

let streams: ReturnType<typeof controllableQuery>[] = []

function resumeOf(call: number): unknown {
  return (mocks.query.mock.calls[call][0] as { options: { resume?: string } }).options.resume
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

beforeEach(() => {
  mocks.runs = []
  streams = []
  mocks.updateAgentSession.mockReset()
  mocks.query.mockReset()
  mocks.query.mockImplementation(() => {
    const stream = controllableQuery()
    streams.push(stream)
    return stream.handle
  })
})

describe('session key ownership (#56)', () => {
  it('lets only one of two concurrent starts resume the same session key', async () => {
    let open: () => void = () => {}
    const barrier = new Promise<void>((resolve) => {
      open = resolve
    })
    const prepareClaudeLaunch = vi.fn(async () => {
      await barrier
      return {} as never
    })
    const first = startAgentRun({
      agentId: 'race',
      prompt: 'one',
      prepareClaudeLaunch,
      options: { sessionKey: 'chan-1' }
    })
    const second = startAgentRun({
      agentId: 'race',
      prompt: 'two',
      prepareClaudeLaunch,
      options: { sessionKey: 'chan-1' }
    })
    // Both are parked inside prepareClaudeLaunch before either stored a run.
    expect(prepareClaudeLaunch).toHaveBeenCalledTimes(2)
    open()
    await Promise.all([first, second])
    const resumes = [resumeOf(0), resumeOf(1)]
    expect(resumes.filter((resume) => resume === 's-chan-1')).toHaveLength(1)
    expect(resumes.filter((resume) => resume === undefined)).toHaveLength(1)
    streams.forEach((stream) => stream.end())
    await flush()
  })

  it('lets different session keys resume in parallel', async () => {
    const prepareClaudeLaunch = vi.fn(async () => ({}) as never)
    await startAgentRun({
      agentId: 'keys',
      prompt: 'a',
      prepareClaudeLaunch,
      options: { sessionKey: 'chan-a' }
    })
    await startAgentRun({
      agentId: 'keys',
      prompt: 'b',
      prepareClaudeLaunch,
      options: { sessionKey: 'chan-b' }
    })
    expect([resumeOf(0), resumeOf(1)]).toEqual(['s-chan-a', 's-chan-b'])
    streams.forEach((stream) => stream.end())
    await flush()
  })

  it('frees the key when the owning run finishes, and when a start fails', async () => {
    const prepareClaudeLaunch = vi.fn(async () => ({}) as never)
    await startAgentRun({ agentId: 'free', prompt: 'a', prepareClaudeLaunch })
    streams[0].end()
    await flush()
    await startAgentRun({ agentId: 'free', prompt: 'b', prepareClaudeLaunch })
    expect(resumeOf(1)).toBe('s-default')

    streams[1].end()
    await flush()
    prepareClaudeLaunch.mockRejectedValueOnce(new Error('auth failed'))
    await expect(
      startAgentRun({ agentId: 'free', prompt: 'c', prepareClaudeLaunch })
    ).rejects.toThrow('auth failed')
    await startAgentRun({ agentId: 'free', prompt: 'd', prepareClaudeLaunch })
    expect(resumeOf(2)).toBe('s-default')
    streams[2].end()
    await flush()
  })
})

describe('session recording after a reset (#57)', () => {
  it('does not record a session for a run that was in flight when the key was reset', async () => {
    const prepareClaudeLaunch = vi.fn(async () => ({}) as never)
    await startAgentRun({
      agentId: 'reset',
      prompt: 'a',
      prepareClaudeLaunch,
      options: { sessionKey: 'chan-1' }
    })
    streams[0].push({ type: 'system', subtype: 'init', session_id: 'sess-live' })
    await flush()
    expect(mocks.updateAgentSession).toHaveBeenCalledWith('reset', {
      lastSessionId: 'sess-live',
      lastSessionCwd: '/repo',
      sessionKey: 'chan-1'
    })
    mocks.updateAgentSession.mockClear()
    invalidateAgentSessions('reset')
    streams[0].push({
      type: 'result',
      subtype: 'success',
      session_id: 'sess-live',
      result: 'done',
      num_turns: 1,
      total_cost_usd: 0
    })
    streams[0].end()
    await flush()
    expect(mocks.updateAgentSession).not.toHaveBeenCalled()
    expect(mocks.runs[0].status).toBe('success')
  })
})
