import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../../../shared/agent-status-types'
import { boardConsoleActivity, boardConsoleState } from './board-console-activity'

const NOW = 1_000_000

function entry(paneKey: string, state: AgentStatusEntry['state'], extra = {}): AgentStatusEntry {
  return {
    paneKey,
    state,
    prompt: '',
    updatedAt: NOW - 1000,
    stateStartedAt: NOW - 5000,
    stateHistory: [],
    ...extra
  } as AgentStatusEntry
}

const base = { acknowledgedAgentsByPaneKey: {}, now: NOW, staleAfterMs: 60_000 }

describe('board console activity', () => {
  it('counts live and needs-you per console tab', () => {
    const input = {
      ...base,
      agentStatusByPaneKey: {
        'a:1': entry('a:1', 'working'),
        'b:1': entry('b:1', 'waiting'),
        'c:1': entry('c:1', 'done'),
        'd:1': entry('d:1', 'blocked')
      }
    }
    expect(boardConsoleActivity(['a', 'b', 'c', 'd', 'e'], input)).toEqual({ live: 3, needsYou: 2 })
  })

  it('ignores stale entries and tabs not on the board', () => {
    const input = {
      ...base,
      agentStatusByPaneKey: {
        'a:1': entry('a:1', 'working', { updatedAt: NOW - 120_000 }),
        'z:1': entry('z:1', 'working')
      }
    }
    expect(boardConsoleActivity(['a'], input)).toEqual({ live: 0, needsYou: 0 })
  })

  it('drops needs-you once the pane was acknowledged after the state began', () => {
    const input = {
      ...base,
      acknowledgedAgentsByPaneKey: { 'b:1': NOW - 100 },
      agentStatusByPaneKey: { 'b:1': entry('b:1', 'waiting') }
    }
    expect(boardConsoleActivity(['b'], input)).toEqual({ live: 1, needsYou: 0 })
  })

  it('does not match a tab id that is only a prefix of another', () => {
    const input = { ...base, agentStatusByPaneKey: { 'ab:1': entry('ab:1', 'working') } }
    expect(boardConsoleActivity(['a'], input).live).toBe(0)
  })

  it('reports the most urgent state across panes', () => {
    const input = {
      ...base,
      agentStatusByPaneKey: { 'a:1': entry('a:1', 'working'), 'a:2': entry('a:2', 'blocked') }
    }
    expect(boardConsoleState('a', input)).toBe('blocked')
    expect(boardConsoleState('x', input)).toBe('idle')
  })
})
