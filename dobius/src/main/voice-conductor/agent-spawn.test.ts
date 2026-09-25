import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { CustomAgent } from '../../shared/agents'
import { createConductorAgentSpawner, isConductorWorkCapacityError } from './agent-spawn'
import { handleConductorCliRequest } from './conductor-cli-routing'
import type { ConductorCliDeps } from './cli-server'
import { createWorkRegistry } from './work-registry'

const agent = {
  id: 'agent-1',
  name: 'Bug Hunter',
  description: '',
  icon: 'bot',
  color: '#b9bcc2',
  systemPrompt: '',
  model: 'claude-opus-4-8',
  cwd: '',
  allowedTools: [],
  skills: [],
  bypassPermissions: false,
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
  updatedAt: 1
} satisfies CustomAgent

const preparation = {
  configDir: '/tmp/claude',
  envPatch: {},
  stripAuthEnv: false,
  provenance: 'test'
}

describe('Voice Conductor agent spawning', () => {
  it('starts a fresh custom-agent run in the requested project and reports completion', async () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), 'dobius-spawn-'))
    const notify = vi.fn(async () => {})
    const startAgentRun = vi.fn(async (args) => {
      args.options.onResult({ subtype: 'success', result: 'Fixed the issue' })
      return 'run-1'
    })
    const prepare = vi.fn(async () => preparation)
    const spawner = createConductorAgentSpawner({
      listAgents: () => [agent],
      getPrepareClaudeLaunch: () => prepare,
      startAgentRun,
      notify,
      workRegistry: createWorkRegistry()
    })

    await expect(spawner.spawn(projectPath, 'bug hunter', ' fix it ')).resolves.toEqual({
      runId: 'run-1'
    })
    expect(startAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-1', cwd: projectPath, prompt: 'fix it' })
    )
    expect(startAgentRun.mock.calls[0][0].options).toMatchObject({
      source: 'channel',
      resume: false,
      spawnedBy: 'voice-conductor'
    })
    expect(notify).toHaveBeenCalledWith('Bug Hunter finished: Fixed the issue')
  })

  it('rejects unknown agents and missing project folders', async () => {
    const spawner = createConductorAgentSpawner({
      listAgents: () => [agent],
      getPrepareClaudeLaunch: () => vi.fn(async () => preparation),
      startAgentRun: vi.fn(),
      notify: vi.fn(),
      workRegistry: createWorkRegistry()
    })

    await expect(spawner.spawn('/definitely/missing', 'Bug Hunter', 'go')).rejects.toThrow(
      'project path does not exist'
    )
    const projectPath = mkdtempSync(path.join(tmpdir(), 'dobius-spawn-'))
    await expect(spawner.spawn(projectPath, 'missing', 'go')).rejects.toThrow('agent not found')
  })
})

type RunCallbacks = {
  onResult(message: { subtype: string; result?: string; errors?: string[] }): void
  onRunEnded(status: 'error' | 'cancelled', summary: string): void
}

function capturingSpawner(startImpl?: (callbacks: RunCallbacks) => Promise<string>) {
  const runs: RunCallbacks[] = []
  const notify = vi.fn(async () => {})
  const workRegistry = createWorkRegistry()
  const startAgentRun = vi.fn(async (args: { options: RunCallbacks }) => {
    runs.push(args.options)
    return startImpl ? startImpl(args.options) : `run-${runs.length}`
  })
  const spawner = createConductorAgentSpawner({
    listAgents: () => [agent],
    getPrepareClaudeLaunch: () => vi.fn(async () => preparation),
    startAgentRun,
    notify,
    workRegistry
  })
  return { spawner, runs, notify, workRegistry, startAgentRun }
}

describe('#61 one conductor-owned work item at a time', () => {
  it('refuses a second spawn while the first run is open, and admits one after it ends', async () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), 'dobius-spawn-'))
    const { spawner, runs, workRegistry, startAgentRun } = capturingSpawner()

    await spawner.spawn(projectPath, 'Bug Hunter', 'first')
    const refused = spawner.spawn(projectPath, 'Bug Hunter', 'second')
    await expect(refused).rejects.toThrow('concurrency cap: 1/1 agents already running')
    await refused.catch((error: unknown) => expect(isConductorWorkCapacityError(error)).toBe(true))
    expect(startAgentRun).toHaveBeenCalledTimes(1)

    runs[0].onResult({ subtype: 'success', result: 'done' })
    expect(workRegistry.capacityError()).toBeNull()
    await expect(spawner.spawn(projectPath, 'Bug Hunter', 'third')).resolves.toEqual({ runId: 'run-2' })
  })

  it('admits only one of two simultaneous spawns', async () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), 'dobius-spawn-'))
    let accept: (runId: string) => void = () => {}
    const { spawner, startAgentRun } = capturingSpawner(
      () => new Promise<string>((resolve) => {
        accept = resolve
      })
    )

    const first = spawner.spawn(projectPath, 'Bug Hunter', 'one')
    const second = spawner.spawn(projectPath, 'Bug Hunter', 'two')
    await expect(second).rejects.toThrow('concurrency cap')
    accept('run-1')
    await expect(first).resolves.toEqual({ runId: 'run-1' })
    expect(startAgentRun).toHaveBeenCalledTimes(1)
  })

  it('releases the slot on every terminal outcome', async () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), 'dobius-spawn-'))
    const outcomes: ((callbacks: RunCallbacks) => void)[] = [
      (run) => run.onResult({ subtype: 'error_during_execution', errors: ['boom'] }),
      (run) => run.onRunEnded('error', 'Run ended unexpectedly without a result'),
      (run) => run.onRunEnded('cancelled', 'stopped by user')
    ]
    for (const finish of outcomes) {
      const { spawner, runs, workRegistry } = capturingSpawner()
      await spawner.spawn(projectPath, 'Bug Hunter', 'go')
      expect(workRegistry.capacityError()).not.toBeNull()
      finish(runs[0])
      expect(workRegistry.capacityError()).toBeNull()
      expect(workRegistry.list()[0]).toMatchObject({ kind: 'spawn', status: 'error' })
    }

    const failedStart = capturingSpawner(async () => {
      throw new Error('Too many concurrent agent runs')
    })
    await expect(failedStart.spawner.spawn(projectPath, 'Bug Hunter', 'go')).rejects.toThrow(
      'Too many concurrent agent runs'
    )
    expect(failedStart.workRegistry.capacityError()).toBeNull()
  })

  it('explains a worker that hit its spending limit', async () => {
    const projectPath = mkdtempSync(path.join(tmpdir(), 'dobius-spawn-'))
    const { spawner, runs, notify } = capturingSpawner()
    await spawner.spawn(projectPath, 'Bug Hunter', 'go')

    runs[0].onResult({ subtype: 'error_max_budget_usd', errors: [] })

    expect(notify).toHaveBeenCalledWith(
      'Bug Hunter failed: stopped: it reached its spending limit for this run'
    )
  })
})

describe('#61 CLI routes share the work cap', () => {
  function routeDeps(workRegistry: ReturnType<typeof createWorkRegistry>) {
    const ask = vi.fn(async () => 'yes')
    const spawnAgent = vi.fn(async () => ({ runId: 'run-1' }))
    const deps = {
      workRegistry,
      imessage: { isAvailable: () => true, unavailableReason: () => null, send: vi.fn(), ask },
      terminals: { spawnAgent }
    } as unknown as ConductorCliDeps
    return { deps, ask, spawnAgent }
  }

  it('refuses dobius-track and dobius-spawn while an item is running, without asking Carson', async () => {
    const workRegistry = createWorkRegistry()
    const { deps, ask, spawnAgent } = routeDeps(workRegistry)
    const ctx = { authorized: true, deps }
    const first = await handleConductorCliRequest(
      '/trackWork',
      { workId: 'wk-1', tabId: 'term-1', requestId: 'req-1', description: 'one' },
      ctx
    )
    expect(first.body).toEqual({ ok: true, workId: 'wk-1' })

    const second = await handleConductorCliRequest(
      '/trackWork',
      { workId: 'wk-2', tabId: 'term-2', requestId: 'req-2', description: 'two' },
      ctx
    )
    expect(second.body).toEqual({
      ok: false,
      error: 'concurrency cap: 1/1 agents already running',
      retryable: true
    })
    const spawn = await handleConductorCliRequest(
      '/spawn',
      { projectPath: '/repo', agentId: 'Bug Hunter', initialPrompt: 'go' },
      ctx
    )
    expect(spawn.body).toMatchObject({ ok: false, retryable: true })
    expect(ask).not.toHaveBeenCalled()
    expect(spawnAgent).not.toHaveBeenCalled()
  })

  it('maps a slot taken during approval to a retryable refusal', async () => {
    const workRegistry = createWorkRegistry()
    const { deps, spawnAgent } = routeDeps(workRegistry)
    spawnAgent.mockRejectedValueOnce(
      new (await import('./agent-spawn')).ConductorWorkCapacityError('concurrency cap: 1/1 agents already running')
    )
    const result = await handleConductorCliRequest(
      '/spawn',
      { projectPath: '/repo', agentId: 'Bug Hunter', initialPrompt: 'go' },
      { authorized: true, deps }
    )
    expect(result).toMatchObject({ status: 200, body: { ok: false, retryable: true } })
  })

  it('will not release a running spawned item through dobius-mark-done', async () => {
    const workRegistry = createWorkRegistry()
    workRegistry.track({ workId: 'spawn-1', tabId: 'agent:a', requestId: 'spawn', description: 'x', kind: 'spawn' })
    const { deps } = routeDeps(workRegistry)

    const result = await handleConductorCliRequest(
      '/markDone',
      { workId: 'spawn-1', summary: 'done' },
      { authorized: true, deps }
    )
    expect(result.status).toBe(409)
    expect(workRegistry.capacityError()).not.toBeNull()
    expect(
      workRegistry.track({ workId: 'spawn-1', tabId: 't', requestId: 'r', description: 'y' })
    ).toMatchObject({ ok: false })
  })
})
