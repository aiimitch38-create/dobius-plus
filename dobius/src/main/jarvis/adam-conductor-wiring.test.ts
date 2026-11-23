import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../persistence'
import { adamConductor, setAdamConductor } from './adam-conductor'
import { startAdamConductor } from './adam-conductor-wiring'
import { AdamThreadStore } from './adam-thread-store'

const hooks = vi.hoisted(() => ({ listener: null as null | (() => void), said: [] as string[] }))
vi.mock('../agent-hooks/server', () => ({
  agentHookServer: {
    subscribeStatusChanges: (listener: () => void) => {
      hooks.listener = listener
      return () => undefined
    }
  }
}))
vi.mock('./live-voice-ipc', () => ({
  sendLiveReport: (text: string) => {
    hooks.said.push(text)
    return true
  }
}))

let directory: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'adam-conductor-'))
  hooks.said = []
  vi.useFakeTimers({ toFake: ['Date'] })
})
afterEach(async () => {
  vi.useRealTimers()
  setAdamConductor(null)
  await rm(directory, { recursive: true, force: true })
})

describe('startAdamConductor', () => {
  it("writes a finished terminal into ADAM's thread and the live call, with no Hermes turn", async () => {
    const state = { status: 'working' as 'working' | 'idle' }
    const runtime = {
      listTerminals: async () => ({
        terminals: [{ handle: 'h1', title: 'Juniper', branch: 'main', worktreePath: '/p' }]
      }),
      readTerminal: async () => ({
        transcript: {
          available: true,
          messages: [{ role: 'assistant', text: 'Fixed the login bug. Tests pass.', timestamp: null }]
        }
      }),
      getTerminalAgentStatus: async () => ({ isRunningAgent: true, status: state.status })
    }
    const thread = new AdamThreadStore(join(directory, 'thread.json'), () => undefined)
    const store = { getSettings: () => ({ voice: {} }) } as unknown as Store
    // Nothing here can reach Hermes: the conductor is handed only the thread and the live call.
    startAdamConductor(store, runtime as never, () => thread)
    const conductor = adamConductor()!
    conductor.noteDispatch('h1', 'fix the login bug', 'quick-hands')
    await conductor.check()
    state.status = 'idle'
    hooks.listener?.()
    await conductor.check()
    vi.setSystemTime(Date.now() + 6_000)
    await conductor.check()

    const text = "Juniper says it's done: Fixed the login bug."
    await vi.waitFor(async () =>
      expect(await thread.get()).toEqual([
        expect.objectContaining({ role: 'assistant', text, conductor: true })
      ])
    )
    expect(hooks.said).toEqual([text])
    expect(conductor.takeContext()).toEqual([text])
  })

  it('stays quiet when "ADAM reports finished work" is off', async () => {
    const thread = new AdamThreadStore(join(directory, 'thread.json'), () => undefined)
    const store = {
      getSettings: () => ({ voice: { adamReportsFinishedWork: false } })
    } as unknown as Store
    startAdamConductor(store, {} as never, () => thread)
    adamConductor()!.noteDispatch('h1', 'x', 'cli')
    expect(adamConductor()!.size).toBe(0)
  })
})
