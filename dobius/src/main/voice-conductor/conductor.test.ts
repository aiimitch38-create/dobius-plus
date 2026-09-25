import { afterEach, describe, it, expect, vi } from 'vitest'
import type { CustomAgent } from '../../shared/agents'

// Stub the agent modules so importing conductor.ts does not pull in the
// electron / SDK chain.
vi.mock('electron', () => ({ app: { getPath: () => '/nonexistent-user-data' } }))
vi.mock('../agents/agents-store', () => ({
  createAgent: vi.fn(),
  listAgents: vi.fn(() => []),
  updateAgent: vi.fn()
}))
vi.mock('../agents/agent-runner', () => ({
  startAgentRun: vi.fn(),
  stopAgentRun: vi.fn()
}))
vi.mock('../agents/default-claude-launch', () => ({
  getDefaultPrepareClaudeLaunch: vi.fn(() => null)
}))
// The stored-agent record is exercised through injected deps below; the engine
// tests only need an id and must not touch the filesystem.
vi.mock('./conductor-agent', async (importOriginal) => ({
  ...(await importOriginal<typeof ConductorAgentModule>()),
  ensureConductorAgentId: vi.fn(() => 'agent-1'),
  ensureConductorDir: vi.fn()
}))

import { listAgents } from '../agents/agents-store'
import { startAgentRun, stopAgentRun } from '../agents/agent-runner'
import { getDefaultPrepareClaudeLaunch } from '../agents/default-claude-launch'
import {
  CONDUCTOR_MAX_BUDGET_USD,
  conductorTurnFailureReply,
  createReplyStore,
  createVoiceConductor
} from './conductor'
import { CONDUCTOR_SYSTEM_PROMPT } from './conductor-system-prompt'
import type * as ConductorAgentModule from './conductor-agent'

describe('Voice Conductor enable gate', () => {
  it('rejects transcripts while the conductor is disabled', async () => {
    const conductor = createVoiceConductor()

    await expect(
      conductor.postTranscript({ requestId: 'req-1', transcript: 'start work' })
    ).rejects.toThrow('Voice Conductor is disabled')
  })

  it('starts without spending a model run — the first transcript establishes the session', async () => {
    vi.mocked(getDefaultPrepareClaudeLaunch).mockReturnValue(async () => ({}) as never)
    vi.mocked(listAgents).mockReturnValue([{ id: 'agent-1', name: 'Voice Conductor' }] as never)
    vi.mocked(startAgentRun).mockClear()

    const conductor = createVoiceConductor()
    await conductor.start()

    expect(conductor.isRunning()).toBe(true)
    expect(startAgentRun).not.toHaveBeenCalled()
  })
})

describe('Voice Conductor tool profile', () => {
  it('runs with its own tool set, not the channel profile', async () => {
    vi.mocked(getDefaultPrepareClaudeLaunch).mockReturnValue(async () => ({}) as never)
    vi.mocked(listAgents).mockReturnValue([{ id: 'agent-1', name: 'Voice Conductor' }] as never)
    vi.mocked(startAgentRun).mockReset()
    vi.mocked(startAgentRun).mockResolvedValue('run-1')

    const conductor = createVoiceConductor()
    await conductor.start()
    await conductor.postTranscript({ requestId: 'req-1', transcript: 'status' })

    const options = vi.mocked(startAgentRun).mock.calls[0][0].options
    expect(options?.profile).toBe('voice-conductor')
    expect(options?.allowedTools).toEqual([
      'Bash',
      'Read',
      'Edit',
      'Write',
      'Glob',
      'Grep',
      'WebFetch',
      'WebSearch'
    ])
  })
})

describe('createReplyStore', () => {
  it('returns the stored reply when no sinceTs is given', () => {
    const store = createReplyStore(() => 100)
    store.set('req-1', 'done')
    expect(store.get('req-1')).toEqual({ message: 'done', ts: 100 })
  })

  it('returns null for an unknown requestId', () => {
    const store = createReplyStore(() => 1)
    expect(store.get('missing')).toBeNull()
  })

  it('returns null when the reply is not strictly newer than sinceTs', () => {
    const store = createReplyStore(() => 50)
    store.set('req-1', 'old')
    // Equal timestamp is not "newer" — poll should keep waiting.
    expect(store.get('req-1', 50)).toBeNull()
    // Older than sinceTs is also withheld.
    expect(store.get('req-1', 60)).toBeNull()
  })

  it('returns the reply when it is newer than sinceTs', () => {
    const store = createReplyStore(() => 200)
    store.set('req-1', 'fresh')
    expect(store.get('req-1', 100)).toEqual({ message: 'fresh', ts: 200 })
  })

  it('overwrites an earlier reply for the same requestId with a new timestamp', () => {
    let clock = 10
    const store = createReplyStore(() => clock)
    store.set('req-1', 'first')
    clock = 20
    store.set('req-1', 'second')
    expect(store.get('req-1')).toEqual({ message: 'second', ts: 20 })
    // The refreshed timestamp is visible to a caller that had seen the first reply.
    expect(store.get('req-1', 15)).toEqual({ message: 'second', ts: 20 })
  })

  it('tracks distinct requestIds independently', () => {
    let clock = 1
    const store = createReplyStore(() => clock)
    store.set('req-a', 'a')
    clock = 2
    store.set('req-b', 'b')
    expect(store.get('req-a')).toEqual({ message: 'a', ts: 1 })
    expect(store.get('req-b')).toEqual({ message: 'b', ts: 2 })
  })
})

type RunOptions = {
  maxBudgetUsd?: number
  onResult(message: Record<string, unknown>): void
  onRunEnded(status: 'error' | 'cancelled', summary: string): void
  onSettled(): void
}

// Each call to startAgentRun is a pending acceptance the test resolves by hand.
function scriptedRuns() {
  const calls: { prompt: string; options: RunOptions; accept(runId: string): void }[] = []
  vi.mocked(startAgentRun).mockReset()
  vi.mocked(startAgentRun).mockImplementation(
    (args) =>
      new Promise<string>((resolve) => {
        calls.push({ prompt: args.prompt, options: args.options as unknown as RunOptions, accept: resolve })
      })
  )
  vi.mocked(stopAgentRun).mockReset()
  vi.mocked(stopAgentRun).mockResolvedValue()
  return calls
}

function success(sessionId = 'session-1') {
  return { subtype: 'success', session_id: sessionId, result: 'ok', errors: [] }
}

async function startedConductor() {
  vi.mocked(getDefaultPrepareClaudeLaunch).mockReturnValue(async () => ({}) as never)
  const conductor = createVoiceConductor()
  await conductor.start()
  return conductor
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  vi.mocked(stopAgentRun).mockReset()
})

describe('#58 turns wait for the previous run to END, not just start', () => {
  it('rapid transcripts never overlap', async () => {
    const calls = scriptedRuns()
    const conductor = await startedConductor()

    const first = conductor.postTranscript({ requestId: 'req-1', transcript: 'one' })
    await flush()
    calls[0].accept('run-1')
    await first
    await conductor.postTranscript({ requestId: 'req-2', transcript: 'two' })
    await conductor.postTranscript({ requestId: 'req-3', transcript: 'three' })
    await flush()

    // run-1 was accepted but is still working: nothing else may start.
    expect(calls).toHaveLength(1)
    expect(conductor.getStatus()).toMatchObject({ running: true, runId: 'run-1', queuedTurns: 2 })

    calls[0].options.onResult(success())
    await flush()
    // The result is in, but the runner still holds run-1's session lease.
    expect(calls).toHaveLength(1)
    calls[0].options.onSettled()
    await flush()
    expect(calls).toHaveLength(2)
    expect(calls[1].prompt).toBe('[req-2] two')
    calls[1].accept('run-2')
    await flush()
    expect(calls).toHaveLength(2)

    calls[1].options.onRunEnded('error', 'Run ended unexpectedly without a result')
    calls[1].options.onSettled()
    await flush()
    expect(calls).toHaveLength(3)
    expect(calls[2].prompt).toBe('[req-3] three')
  })

  it('a late callback from an earlier run does not clear the newer run pointer', async () => {
    const calls = scriptedRuns()
    const conductor = await startedConductor()
    const first = conductor.postTranscript({ requestId: 'req-1', transcript: 'one' })
    await flush()
    calls[0].accept('run-1')
    await first
    calls[0].options.onResult(success())
    calls[0].options.onSettled()
    const second = conductor.postTranscript({ requestId: 'req-2', transcript: 'two' })
    await flush()
    calls[1].accept('run-2')
    await second
    expect(conductor.getStatus().runId).toBe('run-2')

    // run-1's stream finishing after its result must not touch run-2.
    calls[0].options.onRunEnded('error', 'late')

    expect(conductor.getStatus()).toMatchObject({ running: true, runId: 'run-2', lastError: null })
  })

  it('stop stops the open run, the run being accepted and every queued turn', async () => {
    const calls = scriptedRuns()
    const conductor = await startedConductor()
    const first = conductor.postTranscript({ requestId: 'req-1', transcript: 'one' })
    await flush()
    calls[0].accept('run-1')
    await first
    await conductor.postTranscript({ requestId: 'req-2', transcript: 'queued' })

    await conductor.stop()

    expect(stopAgentRun).toHaveBeenCalledWith('run-1')
    // The runner reports the stopped run's end, then settles it after releasing its lease.
    calls[0].options.onRunEnded('cancelled', 'stopped by user')
    calls[0].options.onSettled()
    await flush()
    expect(calls).toHaveLength(1)
    expect(conductor.getReply('req-2')?.message).toBe('Voice Conductor was turned off before this request started.')
    expect(conductor.getStatus()).toMatchObject({ running: false, runId: null })

    // A run accepted after stop() began is still ours: it is stopped as soon as its id is known.
    await conductor.start()
    const pending = conductor.postTranscript({ requestId: 'req-3', transcript: 'three' })
    await flush()
    await conductor.stop()
    calls[1].accept('run-3')
    await pending
    await flush()
    expect(stopAgentRun).toHaveBeenCalledWith('run-3')
    expect(conductor.getStatus().runId).toBeNull()
    calls[1].options.onSettled()

    // The chain is not wedged: a later start runs new turns.
    await conductor.start()
    const next = conductor.postTranscript({ requestId: 'req-4', transcript: 'four' })
    await flush()
    expect(calls).toHaveLength(3)
    calls[2].accept('run-4')
    await next
  })
})

describe('#59 explicit, visible conductor budget', () => {
  it('starts every turn with its own budget and shows it in status', async () => {
    const calls = scriptedRuns()
    const conductor = await startedConductor()
    const turn = conductor.postTranscript({ requestId: 'req-1', transcript: 'go' })
    await flush()
    calls[0].accept('run-1')
    await turn

    expect(calls[0].options.maxBudgetUsd).toBe(CONDUCTOR_MAX_BUDGET_USD)
    expect(conductor.getStatus().maxBudgetUsd).toBe(CONDUCTOR_MAX_BUDGET_USD)
  })

  it('tells Carson when a turn hit the budget instead of going silent', async () => {
    const calls = scriptedRuns()
    const conductor = await startedConductor()
    const turn = conductor.postTranscript({ requestId: 'req-1', transcript: 'big job' })
    await flush()
    calls[0].accept('run-1')
    await turn

    calls[0].options.onResult({ subtype: 'error_max_budget_usd', session_id: 's', errors: [] })

    const expected = `Voice Conductor stopped: this request reached its $${CONDUCTOR_MAX_BUDGET_USD} spending limit before finishing.`
    expect(conductor.getReply('req-1')?.message).toBe(expected)
    expect(conductor.getStatus().lastError).toBe(expected)
  })

  it('keeps the reply the conductor already gave', async () => {
    const calls = scriptedRuns()
    const conductor = await startedConductor()
    const turn = conductor.postTranscript({ requestId: 'req-1', transcript: 'go' })
    await flush()
    calls[0].accept('run-1')
    await turn
    conductor.setReply('req-1', 'On it')

    calls[0].options.onResult({ subtype: 'error_max_budget_usd', session_id: 's', errors: [] })

    expect(conductor.getReply('req-1')?.message).toBe('On it')
  })

  it('maps outcomes to a spoken explanation', () => {
    expect(conductorTurnFailureReply({ subtype: 'success' })).toBeNull()
    expect(conductorTurnFailureReply({ subtype: 'error_max_turns' })).toContain('step limit')
    expect(conductorTurnFailureReply({ ended: 'cancelled' })).toBeNull()
    expect(conductorTurnFailureReply({ ended: 'error' })).toBe('Voice Conductor could not finish this request.')
  })
})

describe('#60 managed conductor defaults reach the stored agent', async () => {
  const actual = await vi.importActual<typeof ConductorAgentModule>('./conductor-agent')
  const {
    CONDUCTOR_MANAGED_DEFAULTS,
    LEGACY_MANAGED_HASHES,
    ensureConductorAgentId,
    managedFieldHash,
    planManagedFieldMigration
  } = actual

  function storedAgent(fields: Partial<CustomAgent>): CustomAgent {
    return {
      id: 'agent-1',
      name: 'Voice Conductor',
      description: '',
      icon: 'bot',
      color: '#b9bcc2',
      systemPrompt: CONDUCTOR_MANAGED_DEFAULTS.systemPrompt,
      model: CONDUCTOR_MANAGED_DEFAULTS.model,
      allowedTools: [...CONDUCTOR_MANAGED_DEFAULTS.allowedTools],
      skills: [],
      cwd: '~/dobius-voice-conductor',
      bypassPermissions: true,
      heartbeat: {
        enabled: false,
        frequency: 'hourly',
        at: '09:00',
        quietStart: '22:00',
        quietEnd: '07:00',
        maxBudgetUsd: 1,
        maxTurns: 20
      },
      notify: 'urgent only',
      channels: { imessage: false },
      createdAt: 1,
      updatedAt: 1,
      ...fields
    }
  }

  function depsFor(agent: CustomAgent, record: ReturnType<typeof planManagedFieldMigration>['record'] | null | 'unreadable') {
    const writes: unknown[] = []
    const updateAgent = vi.fn((_id: string, updates: Partial<CustomAgent>) => {
      Object.assign(agent, updates)
      return [agent]
    })
    return {
      writes,
      updateAgent,
      deps: {
        listAgents: () => [agent],
        createAgent: vi.fn(() => [agent]),
        updateAgent,
        ensureCwd: vi.fn(),
        readRecord: () => record,
        writeRecord: (next: unknown) => writes.push(next)
      }
    }
  }

  it('the shipped prompt before this build is a known managed value', () => {
    // Reverse this build's prompt edits to rebuild the previously shipped text.
    const previous = CONDUCTOR_SYSTEM_PROMPT.replace(
      "Run this BEFORE dobius-send when you're about to kick off real work: it reserves the one work slot, and if it returns ok:false do not send.",
      "Run this right after dobius-send when you've kicked off real work."
    )
      .replace(
        '4. dobius-track to reserve the work slot (stop if it returns ok:false) + dobius-send to the target tab + dobius-reply with a short ack.',
        '4. dobius-send to the target tab + dobius-track to register the work + dobius-reply with a short ack.'
      )
      .replace(
        /Dobius\+ allows ONE running work item at a time[^\n]*When you see this:/,
        'work-registry caps concurrent agents at 1 by default (strictly serial). If you try to dobius-track a second work item while one is running, the call returns `{ok: false, error: "concurrency cap: 1/1 agents already running", retryable: true}`. When you see this:'
      )
      .replace(
        'reserve via dobius-track → dispatch via dobius-send → dobius-reply',
        'dispatch via dobius-send → register via dobius-track → dobius-reply'
      )
    expect(previous).not.toBe(CONDUCTOR_SYSTEM_PROMPT)
    expect(LEGACY_MANAGED_HASHES.systemPrompt).toContain(managedFieldHash(previous))
    expect(LEGACY_MANAGED_HASHES.systemPrompt).not.toContain(managedFieldHash(CONDUCTOR_SYSTEM_PROMPT))

    // An install created before the record existed (no record) is migrated.
    const plan = planManagedFieldMigration(storedAgent({ systemPrompt: previous }), CONDUCTOR_MANAGED_DEFAULTS, null)
    expect(plan.updates).toEqual({ systemPrompt: CONDUCTOR_SYSTEM_PROMPT })
  })

  it('without a record, an unknown prompt is treated as the user\'s own', () => {
    const plan = planManagedFieldMigration(
      storedAgent({ systemPrompt: 'something Carson wrote' }),
      CONDUCTOR_MANAGED_DEFAULTS,
      null
    )
    expect(plan.updates).toEqual({})
    expect(plan.kept).toEqual(['systemPrompt'])
  })

  it('updates untouched managed fields and keeps user overrides', () => {
    const agent = storedAgent({ systemPrompt: 'prompt v1', model: 'sonnet', allowedTools: ['Read'] })
    const { deps, updateAgent, writes } = depsFor(agent, {
      version: 1,
      agentId: 'agent-1',
      // We last wrote prompt v1 and tools [Read]; the model 'sonnet' is Carson's edit.
      applied: {
        systemPrompt: managedFieldHash('prompt v1'),
        model: managedFieldHash('opus'),
        allowedTools: managedFieldHash(['Read'])
      }
    })

    expect(ensureConductorAgentId(deps)).toBe('agent-1')

    expect(updateAgent).toHaveBeenCalledWith('agent-1', {
      systemPrompt: CONDUCTOR_MANAGED_DEFAULTS.systemPrompt,
      allowedTools: CONDUCTOR_MANAGED_DEFAULTS.allowedTools
    })
    expect(agent.model).toBe('sonnet')
    expect(writes).toEqual([
      {
        version: 1,
        agentId: 'agent-1',
        applied: {
          systemPrompt: managedFieldHash(CONDUCTOR_MANAGED_DEFAULTS.systemPrompt),
          model: managedFieldHash('opus'),
          allowedTools: managedFieldHash(CONDUCTOR_MANAGED_DEFAULTS.allowedTools)
        }
      }
    ])
  })

  it('keeps a prompt the user edited after the last migration', () => {
    const agent = storedAgent({ systemPrompt: 'my own prompt' })
    const { deps, updateAgent } = depsFor(agent, {
      version: 1,
      agentId: 'agent-1',
      applied: { systemPrompt: managedFieldHash('prompt v1') }
    })

    ensureConductorAgentId(deps)

    expect(updateAgent).not.toHaveBeenCalled()
    expect(agent.systemPrompt).toBe('my own prompt')
  })

  it('ignores a record written for a different agent', () => {
    const agent = storedAgent({ systemPrompt: 'prompt v1' })
    const { deps, updateAgent } = depsFor(agent, {
      version: 1,
      agentId: 'agent-OLD',
      applied: { systemPrompt: managedFieldHash('prompt v1') }
    })

    ensureConductorAgentId(deps)

    expect(updateAgent).not.toHaveBeenCalled()
  })

  it('leaves the agent alone while the record is unreadable', () => {
    const agent = storedAgent({ systemPrompt: 'prompt v1' })
    const { deps, updateAgent, writes } = depsFor(agent, 'unreadable')

    ensureConductorAgentId(deps)

    expect(updateAgent).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })
})
