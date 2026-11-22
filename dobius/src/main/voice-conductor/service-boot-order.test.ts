import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../shared/types'
import type { DobiusCliDispatcher } from '../dobius-cli/dispatch-server'
import type { PrepareClaudeLaunch } from '../agents/agent-runner'
import { getDefaultPrepareClaudeLaunch, setDefaultPrepareClaudeLaunch } from '../agents/default-claude-launch'

const state = vi.hoisted(() => ({
  userData: '',
  running: false,
  cliStarts: 0,
  cliStops: 0
}))
state.userData = mkdtempSync(path.join(tmpdir(), 'conductor-boot-'))

vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))
vi.mock('../agents/agents-store', () => ({ listAgents: () => [] }))
vi.mock('../agents/agent-runner', () => ({ startAgentRun: vi.fn() }))
// Same guard as the real conductor.start(): it refuses to start without a preparer.
vi.mock('./conductor', () => ({
  createVoiceConductor: () => ({
    start: vi.fn(async () => {
      if (!getDefaultPrepareClaudeLaunch()) {
        throw new Error('no Claude launch preparer registered')
      }
      state.running = true
    }),
    stop: vi.fn(async () => {
      state.running = false
    }),
    isRunning: () => state.running
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
  startConductorCliServer: () => {
    state.cliStarts += 1
  },
  stopConductorCliServer: () => {
    state.cliStops += 1
  }
}))

import { syncVoiceConductorFromSettings } from './service'

describe('Voice Conductor boot order', () => {
  it('starts once the Claude launch preparer is registered after the boot sync', async () => {
    const enabled = { voice: { conductorEnabled: true } } as unknown as GlobalSettings
    // Boot: main syncs the conductor before the main window registers the preparer.
    syncVoiceConductorFromSettings(enabled, {} as DobiusCliDispatcher)
    await new Promise((resolve) => setImmediate(resolve))
    expect(state.running).toBe(false)

    setDefaultPrepareClaudeLaunch((async () => ({})) as unknown as PrepareClaudeLaunch)
    await new Promise((resolve) => setImmediate(resolve))

    expect(state.running).toBe(true)
    expect(state.cliStarts - state.cliStops).toBe(1)
  })
})
