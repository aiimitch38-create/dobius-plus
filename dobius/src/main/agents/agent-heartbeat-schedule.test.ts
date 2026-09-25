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
  updateAgentHeartbeatAt: (id: string, at: number) => {
    const agent = mocks.agents.find((candidate) => candidate.id === id)
    if (agent) {
      agent.lastHeartbeatAt = at
    }
  }
}))
vi.mock('./agent-runner', () => ({
  hasLiveAgentRun: () => false,
  startAgentRun: mocks.startAgentRun
}))

import { agentHeartbeatInternals, startAgentHeartbeats } from './agent-heartbeat-service'

function hourlyAgent(lastHeartbeatAt: number): CustomAgent {
  return {
    id: 'gunner',
    name: 'Gunner',
    engine: 'claude',
    lastHeartbeatAt,
    heartbeat: {
      enabled: true,
      frequency: 'hourly',
      at: '09:00',
      quietStart: '00:00',
      quietEnd: '00:00',
      maxBudgetUsd: 0.1,
      maxTurns: 5
    }
  } as CustomAgent
}

const at = (hour: number, minute: number, second = 0): Date =>
  new Date(2026, 8, 24, hour, minute, second)

afterEach(() => {
  vi.useRealTimers()
})

describe('hourly heartbeat schedule (BUILD-024 #66)', () => {
  it('is due in any minute of an hour it has not run in, and not again in that hour', () => {
    const { isDue } = agentHeartbeatInternals
    expect(isDue(hourlyAgent(at(9, 0).getTime()), at(10, 7))).toBe(true)
    expect(isDue(hourlyAgent(at(10, 0, 30).getTime()), at(10, 59))).toBe(false)
  })

  it('a delayed tick (after sleep) fires one heartbeat for the hour, never a burst', async () => {
    vi.useFakeTimers()
    // Three hours asleep, and the ticks now land at :03:17, :04:17, ... never :00.
    vi.setSystemTime(at(10, 3, 17))
    mocks.agents = [hourlyAgent(at(7, 0).getTime())]
    startAgentHeartbeats(async () => ({}) as never)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(mocks.startAgentRun).toHaveBeenCalledTimes(1)
    // The next clock hour gets its own single heartbeat.
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(mocks.startAgentRun).toHaveBeenCalledTimes(2)
  })
})
