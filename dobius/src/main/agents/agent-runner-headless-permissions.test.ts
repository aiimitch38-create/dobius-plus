import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk'
import type { AgentRun, AgentRunEvent } from '../../shared/agents'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  runs: new Map<string, AgentRun>(),
  events: [] as AgentRunEvent[]
}))

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))
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
    allowedTools: ['Read'],
    skills: [],
    cwd: '/repo',
    bypassPermissions: false
  }),
  getAgentSessionForKey: () => null,
  updateAgentSession: vi.fn()
}))
vi.mock('./agent-runs-store', () => ({
  addStoredAgentRun: (run: AgentRun) => {
    mocks.runs.set(run.id, { ...run })
  },
  getStoredAgentRun: (id: string) => {
    const run = mocks.runs.get(id)
    return run ? { ...run } : null
  },
  listStoredAgentRuns: () => [...mocks.runs.values()],
  updateStoredAgentRun: (id: string, updates: Partial<AgentRun>) => {
    const run = mocks.runs.get(id)
    if (!run) {
      return null
    }
    Object.assign(run, updates)
    return { ...run }
  },
  getAgentRunOutbox: () => []
}))
vi.mock('./agent-run-events', () => ({
  broadcastRunEvent: (event: AgentRunEvent) => {
    mocks.events.push(event)
  },
  broadcastRunsChanged: vi.fn(),
  eventBase: (runId: string, agentId: string) => ({ runId, agentId, ts: 0 }),
  reduceMessage: () => []
}))
vi.mock('./agent-tools/dobius-tool-server', () => ({ buildDobiusToolServer: vi.fn(() => ({})) }))
vi.mock('./agent-hard-rails', () => ({ buildAgentHardRailHooks: vi.fn(() => ({})) }))
vi.mock('./agent-notification-store', () => ({
  appendAgentNotification: vi.fn(),
  appendAgentRunNotification: vi.fn()
}))
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
vi.mock('./default-claude-launch', () => ({
  getDefaultPrepareClaudeLaunch: () => async () => ({})
}))

import { startAgentRun } from './agent-runner'
import {
  BYPASS_RUN_UNSUPPORTED_REASON,
  createAgentCanUseTool,
  listAgentDecisions,
  resolveAgentDecision,
  setDecisionBypassRunHandler
} from './agent-decision-queue'
import { RpcDispatcher } from '../runtime/rpc/dispatcher'
import type { DobiusRuntimeService } from '../runtime/dobius-runtime'
import { CUSTOM_AGENT_METHODS } from '../runtime/rpc/methods/custom-agents'

type CapturedOptions = {
  canUseTool?: CanUseTool
  permissionMode?: string
  allowDangerouslySkipPermissions?: boolean
  maxTurns?: number
  maxBudgetUsd?: number
}

type ScriptedQuery = {
  finish: (messages: unknown[]) => void
  setPermissionMode: ReturnType<typeof vi.fn>
}

// A fake SDK Query: the stream stays open until the test calls finish().
function scriptedQuery(): ScriptedQuery & AsyncIterable<unknown> {
  let release: (messages: unknown[]) => void = () => {}
  const gate = new Promise<unknown[]>((resolve) => {
    release = resolve
  })
  return {
    finish: (messages) => release(messages),
    setPermissionMode: vi.fn(async () => {
      throw new Error(
        'Cannot set permission mode to bypassPermissions because the session was not launched with --dangerously-skip-permissions'
      )
    }),
    interrupt: vi.fn(),
    async *[Symbol.asyncIterator]() {
      for (const message of await gate) {
        yield message
      }
    }
  } as ScriptedQuery & AsyncIterable<unknown>
}

function resultMessage(permissionDenials: { tool_name: string; tool_use_id: string }[] = []) {
  return {
    type: 'result',
    subtype: 'success',
    result: 'done',
    session_id: 's1',
    num_turns: 2,
    total_cost_usd: 0.01,
    permission_denials: permissionDenials.map((denial) => ({ ...denial, tool_input: {} }))
  }
}

const prepareClaudeLaunch = vi.fn(async () => ({}) as never)

function lastLaunch(): { options: CapturedOptions; query: ScriptedQuery; runId: string } {
  const call = mocks.query.mock.calls.at(-1)?.at(0) as { options: CapturedOptions }
  const query = mocks.query.mock.results.at(-1)?.value as ScriptedQuery
  const runId = [...mocks.runs.keys()].at(-1) as string
  return { options: call.options, query, runId }
}

async function launch(options: Parameters<typeof startAgentRun>[0]['options']) {
  await startAgentRun({ agentId: 'a', prompt: 'go', prepareClaudeLaunch, options })
  return lastLaunch()
}

function askTool(canUseTool: CanUseTool, toolName: string, toolUseID: string) {
  return canUseTool(
    toolName,
    { command: 'rm -rf build' },
    { signal: new AbortController().signal, toolUseID } as Parameters<CanUseTool>[2]
  )
}

// Bounded: a headless prompt must answer on its own, not wait for a person.
async function settlesAlone<T>(promise: Promise<T>): Promise<T | 'still-waiting'> {
  return Promise.race([
    promise,
    new Promise<'still-waiting'>((resolve) => setTimeout(() => resolve('still-waiting'), 50))
  ])
}

async function waitForEnd(runId: string): Promise<AgentRun> {
  await vi.waitFor(() => {
    expect(mocks.runs.get(runId)?.status).not.toBe('running')
  })
  return mocks.runs.get(runId) as AgentRun
}

const runtime = { getRuntimeId: () => 'test-runtime' } as unknown as DobiusRuntimeService

async function rpcRun(params: Record<string, unknown>) {
  const dispatcher = new RpcDispatcher({ runtime, methods: CUSTOM_AGENT_METHODS })
  const response = await dispatcher.dispatch({
    id: 'req-1',
    authToken: 'tok',
    method: 'agent.run',
    params: { id: 'a', prompt: 'go', ...params }
  })
  expect(response).toMatchObject({ ok: true })
  return lastLaunch()
}

beforeEach(() => {
  mocks.runs.clear()
  mocks.events.length = 0
  mocks.query.mockReset()
  mocks.query.mockImplementation(scriptedQuery)
})

describe('headless runs never wait on a permission prompt (#74, N1)', () => {
  it.each([
    ['heartbeat', { source: 'heartbeat', permissionMode: 'dontAsk' }],
    ['asana', { source: 'asana', permissionMode: 'dontAsk', allowedTools: [] }],
    ['iMessage', { source: 'channel', profile: 'imessage', permissionMode: 'dontAsk' }],
    ['workflow', { source: 'channel', permissionMode: 'dontAsk', resume: false }],
    ['Communications provider', { source: 'channel' }]
  ] as [string, Parameters<typeof startAgentRun>[0]['options']][])(
    '%s run: a prompt is denied at once and recorded on the run',
    async (_label, options) => {
      const { options: sdkOptions, query, runId } = await launch(options)
      expect(sdkOptions.canUseTool).toBeTypeOf('function')
      const answer = await settlesAlone(
        askTool(sdkOptions.canUseTool as CanUseTool, 'Bash', 'tool-1')
      )
      expect(answer).toMatchObject({ behavior: 'deny' })
      expect(listAgentDecisions()).toEqual([])
      expect(mocks.runs.get(runId)?.permissionDenials).toEqual([
        expect.objectContaining({ toolName: 'Bash', toolUseId: 'tool-1' })
      ])
      expect(mocks.events).toContainEqual(
        expect.objectContaining({ runId, kind: 'error', toolName: 'Bash' })
      )

      // The result's own denial list repeats tool-1: recorded once, then shown in the summary
      // (except for channel runs, whose summary is the chat reply; see the F1 test below).
      query.finish([resultMessage([{ tool_name: 'Bash', tool_use_id: 'tool-1' }])])
      const run = await waitForEnd(runId)
      expect(run.permissionDenials).toHaveLength(1)
      if (options?.source === 'channel') {
        expect(run.summary).toBe('done')
      } else {
        expect(run.summary).toContain('done')
        expect(run.summary).toContain(
          'Blocked: 1 tool request(s) needed approval and were denied (Bash)'
        )
      }
    }
  )

  it('channel run: the Blocked note stays out of the chat reply, denials stay on the run', async () => {
    const { options, query, runId } = await rpcRun({ source: 'channel', sessionKey: 'c1' })
    await askTool(options.canUseTool as CanUseTool, 'Bash', 'ch-1')
    query.finish([resultMessage([{ tool_name: 'Edit', tool_use_id: 'ch-2' }])])
    const run = await waitForEnd(runId)
    expect(run.summary).toBe('done')
    expect(run.permissionDenials?.map((denial) => denial.toolUseId)).toEqual(['ch-1', 'ch-2'])
    expect(mocks.events.filter((event) => event.kind === 'error')).toHaveLength(2)
  })

  it('past the saved cap: each denial broadcasts once and the note counts every one', async () => {
    const { options, query, runId } = await launch({ source: 'heartbeat', permissionMode: 'dontAsk' })
    const ids = Array.from({ length: 200 }, (_, index) => `many-${index}`)
    for (const id of ids) {
      await askTool(options.canUseTool as CanUseTool, 'Bash', id)
    }
    // The result repeats all 200 ids; none may broadcast or count a second time.
    query.finish([resultMessage(ids.map((id) => ({ tool_name: 'Bash', tool_use_id: id })))])
    const run = await waitForEnd(runId)
    expect(run.permissionDenials).toHaveLength(20)
    expect(mocks.events.filter((event) => event.kind === 'error')).toHaveLength(200)
    expect(run.summary).toContain('Blocked: 200 tool request(s) needed approval and were denied (Bash)')
  })

  it('RPC run without a source (CLI "agents run") is headless, not queued for a person', async () => {
    const { options, query, runId } = await rpcRun({})
    const answer = await settlesAlone(askTool(options.canUseTool as CanUseTool, 'Write', 't-9'))
    expect(answer).toMatchObject({ behavior: 'deny' })
    expect(listAgentDecisions()).toEqual([])
    expect(mocks.runs.get(runId)?.permissionDenials?.[0]?.reason).toContain('CLI/RPC run')
    query.finish([resultMessage()])
    expect((await waitForEnd(runId)).summary).toContain('Blocked: 1 tool request(s)')
  })

  it('RPC run claiming source manual is still headless (origin is not RPC-settable)', async () => {
    const { options, query, runId } = await rpcRun({ source: 'manual' })
    const answer = await settlesAlone(askTool(options.canUseTool as CanUseTool, 'Bash', 't-2'))
    expect(answer).toMatchObject({ behavior: 'deny' })
    expect(listAgentDecisions()).toEqual([])
    query.finish([resultMessage()])
    await waitForEnd(runId)
  })

  it('dontAsk denials the CLI makes itself are recorded from the stream', async () => {
    const { query, runId } = await launch({ source: 'heartbeat', permissionMode: 'dontAsk' })
    query.finish([
      {
        type: 'system',
        subtype: 'permission_denied',
        tool_name: 'WebFetch',
        tool_use_id: 'w-1',
        message: 'WebFetch is not allowed in dontAsk mode',
        uuid: 'u1',
        session_id: 's1'
      },
      resultMessage([
        { tool_name: 'WebFetch', tool_use_id: 'w-1' },
        { tool_name: 'Edit', tool_use_id: 'e-1' }
      ])
    ])
    const run = await waitForEnd(runId)
    expect(run.permissionDenials?.map((denial) => denial.toolUseId)).toEqual(['w-1', 'e-1'])
    expect(run.permissionDenials?.[0]?.reason).toBe('WebFetch is not allowed in dontAsk mode')
    expect(run.summary).toContain('Blocked: 2 tool request(s) needed approval and were denied (WebFetch, Edit)')
  })

  it('a run with no denials keeps its summary unchanged', async () => {
    const { query, runId } = await launch({ source: 'heartbeat', permissionMode: 'dontAsk' })
    query.finish([resultMessage()])
    const run = await waitForEnd(runId)
    expect(run.summary).toBe('done')
    expect(run.permissionDenials).toBeUndefined()
  })

  it('an Agents-page run still queues the prompt for the person who pressed Run', async () => {
    const { options, query, runId } = await launch({ origin: 'agents-page' })
    const answer = settlesAlone(askTool(options.canUseTool as CanUseTool, 'Bash', 'm-1'))
    expect(listAgentDecisions()).toHaveLength(1)
    expect(await answer).toBe('still-waiting')
    query.finish([resultMessage()])
    await waitForEnd(runId)
    expect(listAgentDecisions()).toEqual([])
  })
})

describe('"Bypass run" follows the launched session\'s capability (#75)', () => {
  it('SDK contract: a default-mode Agents-page run is launched without bypass support', async () => {
    const { options, query, runId } = await launch({ origin: 'agents-page' })
    expect(options.permissionMode).toBe('default')
    expect(options.allowDangerouslySkipPermissions).toBeUndefined()
    void askTool(options.canUseTool as CanUseTool, 'Bash', 'b-1')
    const [decision] = listAgentDecisions()
    expect(decision?.bypassRunUnavailableReason).toBe(BYPASS_RUN_UNSUPPORTED_REASON)

    await expect(
      resolveAgentDecision({ id: decision?.id as string, action: 'bypassRun' })
    ).rejects.toThrow(BYPASS_RUN_UNSUPPORTED_REASON)
    // Refused before the SDK call, and the prompt is still waiting for a real answer.
    expect(query.setPermissionMode).not.toHaveBeenCalled()
    expect(listAgentDecisions()).toHaveLength(1)

    query.finish([resultMessage()])
    await waitForEnd(runId)
  })

  it('a session launched with bypass support switches mode and approves', async () => {
    const handler = vi.fn(async () => {})
    setDecisionBypassRunHandler(handler)
    const canUseTool = createAgentCanUseTool({
      runId: 'r-bypass',
      agentId: 'a',
      cwd: '/repo',
      bypassRunSupported: true
    })
    const answer = askTool(canUseTool, 'Bash', 'b-2')
    const [decision] = listAgentDecisions()
    expect(decision?.bypassRunUnavailableReason).toBeUndefined()
    await resolveAgentDecision({ id: decision?.id as string, action: 'bypassRun' })
    expect(handler).toHaveBeenCalledWith('r-bypass')
    await expect(answer).resolves.toMatchObject({ behavior: 'allow' })
  })
})

describe('agent.run over RPC with omitted limits reaches the runner defaults (#8)', () => {
  it('no caps passed: 100 turns and $2', async () => {
    const { options, query, runId } = await rpcRun({})
    expect(options.maxTurns).toBe(100)
    expect(options.maxBudgetUsd).toBe(2)
    query.finish([resultMessage()])
    await waitForEnd(runId)
  })

  it('channel source with no caps: 100 turns and $1', async () => {
    const { options, query, runId } = await rpcRun({ source: 'channel', sessionKey: 'c1' })
    expect(options.maxTurns).toBe(100)
    expect(options.maxBudgetUsd).toBe(1)
    expect(options.permissionMode).toBe('dontAsk')
    query.finish([resultMessage()])
    await waitForEnd(runId)
  })

  it('explicit caps pass through', async () => {
    const { options, query, runId } = await rpcRun({ maxTurns: 7, maxBudgetUsd: 0.5 })
    expect(options.maxTurns).toBe(7)
    expect(options.maxBudgetUsd).toBe(0.5)
    query.finish([resultMessage()])
    await waitForEnd(runId)
  })
})
