import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../shared/types'
import type { DobiusCliDispatcher } from '../dobius-cli/dispatch-server'
import type { ConductorCliDeps } from './cli-server'

const state = vi.hoisted(() => ({
  userData: '',
  deps: [] as unknown[],
  assertExecutionAdmitted: vi.fn()
}))
state.userData = mkdtempSync(path.join(tmpdir(), 'conductor-service-'))

vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))
vi.mock('../agents/agents-store', () => ({ listAgents: () => [] }))
vi.mock('../agents/agent-runner', () => ({ startAgentRun: vi.fn() }))
vi.mock('../agents/execution-gate', () => ({
  assertExecutionAdmitted: state.assertExecutionAdmitted
}))
vi.mock('../agents/default-claude-launch', () => ({ getDefaultPrepareClaudeLaunch: () => null }))
vi.mock('./conductor', () => ({
  createVoiceConductor: () => ({
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    isRunning: () => true
  })
}))
vi.mock('./imessage-bridge', () => ({
  createIMessageBridge: () => ({ unavailableReason: () => null, send: vi.fn() })
}))
vi.mock('./conductor-settings', () => ({
  conductorImessageHandle: () => null,
  createSettingsLaneAsanaQueue: () => ({ fetch: vi.fn() })
}))
vi.mock('./cli-server', () => ({
  startConductorCliServer: (deps: unknown) => state.deps.push(deps),
  stopConductorCliServer: vi.fn()
}))

import { syncVoiceConductorFromSettings } from './service'

function settings(conductorEnabled: boolean): GlobalSettings {
  return { voice: { conductorEnabled } } as unknown as GlobalSettings
}

describe('BUILD-036 F2: one work registry per process', () => {
  it('an off/on toggle keeps a live spawned worker holding the cap', async () => {
    const runtime = {
      resolveActiveTerminal: vi.fn(),
      listTerminals: vi.fn(async () => ({ terminals: [] })),
      sendTerminal: vi.fn(async (_handle, _action, options) => options?.beforeWrite?.('pty-1'))
    } satisfies DobiusCliDispatcher
    syncVoiceConductorFromSettings(settings(true), runtime)
    const first = (state.deps.at(-1) as ConductorCliDeps).workRegistry
    expect(
      first.track({
        workId: 'spawn-1',
        tabId: 'agent:a',
        requestId: 'spawn',
        description: 'worker',
        kind: 'spawn'
      })
    ).toEqual({ ok: true })

    syncVoiceConductorFromSettings(settings(false), runtime)
    syncVoiceConductorFromSettings(settings(true), runtime)
    const second = (state.deps.at(-1) as ConductorCliDeps).workRegistry

    expect(state.deps).toHaveLength(2)
    expect(second).toBe(first)
    expect(second.list()).toMatchObject([{ workId: 'spawn-1', status: 'running' }])
    expect(second.capacityError()).toBe('concurrency cap: 1/1 agents already running')

    await (state.deps.at(-1) as ConductorCliDeps).terminals.sendToTab('term-1', 'continue')
    expect(state.assertExecutionAdmitted).toHaveBeenCalledWith('agent-run')
  })
})
