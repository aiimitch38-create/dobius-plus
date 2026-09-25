// @vitest-environment happy-dom

/* BUILD-041 (#98): a finished run's summary must carry its age, not read as live activity. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { AgentLivePulse } from './AgentLivePulse'
import type { AgentRun, CustomAgent } from '../../../../shared/agents'

const NOW = Date.UTC(2026, 8, 25, 12, 0, 0)
const DAY = 24 * 60 * 60 * 1000

const agent = {
  id: 'a1',
  name: 'Scout',
  icon: 'compass',
  color: 'blue',
  heartbeat: { enabled: false }
} as unknown as CustomAgent

function run(patch: Partial<AgentRun>): AgentRun {
  return {
    id: 'r1',
    agentId: 'a1',
    prompt: 'p',
    startedAt: NOW - 3 * DAY - 60_000,
    status: 'success',
    ...patch
  }
}

function renderPulse(runs: AgentRun[]): void {
  render(
    <AgentLivePulse
      agents={[agent]}
      runs={runs}
      decisions={[]}
      terminals={[]}
      selectedAgentId={null}
      selectedTerminalId={null}
      onSelectAgent={() => {}}
      onSelectTerminal={() => {}}
    />
  )
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('AgentLivePulse run text', () => {
  it('labels a finished run summary with its age', () => {
    vi.useFakeTimers({ now: NOW })
    renderPulse([run({ endedAt: NOW - 3 * DAY, summary: 'Fixed the login bug' })])
    expect(screen.getByText('Last run 3d ago · Fixed the login bug')).toBeTruthy()
    expect(screen.queryByText('Fixed the login bug')).toBeNull()
  })

  it('falls back to the start time and the status when the run has no end or summary', () => {
    vi.useFakeTimers({ now: NOW })
    renderPulse([run({ startedAt: NOW - 2 * 60 * 60 * 1000, status: 'error' })])
    expect(screen.getByText('Last run 2h ago · error')).toBeTruthy()
  })

  it('shows a running run summary as current activity', () => {
    vi.useFakeTimers({ now: NOW })
    renderPulse([run({ startedAt: NOW - 60_000, status: 'running', summary: 'Reading files' })])
    expect(screen.getByText('Reading files')).toBeTruthy()
  })
})
