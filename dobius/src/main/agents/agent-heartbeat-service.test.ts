import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CustomAgent } from '../../shared/agents'

const mocks = vi.hoisted(() => ({
  agents: [] as CustomAgent[],
  startAgentRun: vi.fn(async (_args: { agentId: string }) => 'run-1')
}))

vi.mock('electron', () => ({ Notification: vi.fn() }))
vi.mock('./agent-briefing-store', () => ({
  appendBriefingItem: vi.fn(),
  broadcastBriefingChanged: vi.fn()
}))
vi.mock('./agent-notification-store', () => ({ appendAgentNotification: vi.fn() }))
vi.mock('./agents-config-store', () => ({
  consumePingBudget: () => false,
  getAgentsPaused: () => false
}))
vi.mock('./agents-store', () => ({
  getAgent: (id: string) => mocks.agents.find((agent) => agent.id === id),
  listAgents: () => mocks.agents,
  updateAgentHeartbeatAt: vi.fn()
}))
vi.mock('./agent-runner', () => ({
  hasLiveAgentRun: () => false,
  startAgentRun: mocks.startAgentRun
}))

import { startAgentHeartbeats } from './agent-heartbeat-service'

function dueAgent(id: string, engine: 'claude' | 'codex'): CustomAgent {
  return {
    id,
    name: id,
    engine,
    heartbeat: {
      enabled: true,
      frequency: 'every10min',
      at: '09:00',
      quietStart: '00:00',
      quietEnd: '00:00',
      maxBudgetUsd: 0.1,
      maxTurns: 5
    }
  } as CustomAgent
}

afterEach(() => {
  vi.useRealTimers()
})

describe('agent heartbeats', () => {
  it('never dispatches a heartbeat for a Codex agent, and warns once instead of every tick', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.agents = [dueAgent('edith', 'codex'), dueAgent('atlas', 'claude')]
    startAgentHeartbeats(async () => ({}) as never)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mocks.startAgentRun.mock.calls.map(([args]) => args.agentId)).toEqual(['atlas', 'atlas'])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('Codex agents cannot run heartbeats')
  })
})
