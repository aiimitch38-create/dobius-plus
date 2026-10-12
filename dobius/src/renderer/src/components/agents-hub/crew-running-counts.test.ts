import { describe, expect, it } from 'vitest'
import type { AgentRun, CustomAgent } from '../../../../shared/agents'
import { crewRunningCounts, crewSubtitle } from './crew-running-counts'

const agent = (id: string): CustomAgent => ({ id }) as CustomAgent
const run = (id: string, agentId: string, status: AgentRun['status']): AgentRun => ({
  id,
  agentId,
  prompt: 'p',
  startedAt: 1,
  status
})

describe('crew running counts (BUILD-041, #99)', () => {
  it('counts one agent with two running runs as one active agent and two runs', () => {
    const runs = [run('r1', 'a1', 'running'), run('r2', 'a1', 'running')]
    expect(crewRunningCounts([agent('a1'), agent('a2')], runs)).toEqual({
      activeAgents: 1,
      runningRuns: 2
    })
    expect(crewSubtitle([agent('a1'), agent('a2')], runs)).toBe(
      '2 agents · 1 running · 2 runs active'
    )
  })

  it('ignores finished runs and keeps the short label when counts match', () => {
    const runs = [run('r1', 'a1', 'running'), run('r2', 'a2', 'success')]
    expect(crewSubtitle([agent('a1'), agent('a2')], runs)).toBe('2 agents · 1 running')
  })

  it('does not count a run whose agent is no longer configured as an active agent', () => {
    const runs = [run('r1', 'gone', 'running')]
    expect(crewSubtitle([agent('a1')], runs)).toBe('1 agents · 0 running · 1 run active')
  })

  it('says no agents configured when there are none', () => {
    expect(crewSubtitle([], [])).toBe('No agents configured')
  })
})
