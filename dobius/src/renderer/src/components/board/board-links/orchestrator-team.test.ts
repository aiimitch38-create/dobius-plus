import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/launch-agent-in-new-tab', () => ({ launchAgentInNewTab: vi.fn() }))

import { nextTeamAgent, teamGrowth, teamSpawnCenter } from './orchestrator-team'

describe('orchestrator team rules', () => {
  it('grows to the target, never shrinks, caps at 12', () => {
    expect(teamGrowth(2, 5)).toBe(3)
    expect(teamGrowth(5, 3)).toBe(0)
    expect(teamGrowth(0, 40)).toBe(12)
    expect(teamGrowth(1, Number.NaN)).toBe(0)
  })

  it('cycles the team agent and wraps', () => {
    expect(nextTeamAgent(['claude', 'codex'], undefined)).toBe('claude')
    expect(nextTeamAgent(['claude', 'codex'], 'claude')).toBe('codex')
    expect(nextTeamAgent(['claude', 'codex'], 'codex')).toBe('claude')
    expect(nextTeamAgent([], 'gemini')).toBe('gemini')
  })

  it('places new consoles to the right of the card', () => {
    const c = teamSpawnCenter({ x: 0, y: 0, w: 360, h: 460 }, 1)
    expect(c.x).toBeGreaterThan(360)
    expect(c.y).toBe(230)
  })
})
