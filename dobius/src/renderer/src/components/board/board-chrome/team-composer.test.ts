import { describe, expect, it } from 'vitest'
import type { TuiAgent } from '../../../../../shared/types'
import {
  TEAM_MAX_SLOTS,
  addSlot,
  defaultAgentForRole,
  fillAllSlots,
  initialTeam,
  parseRoleAgentMap,
  rememberRoleAgents,
  removeSlot,
  resizeTeam,
  setSlotAgent,
  setSlotRole,
  teamGroupName
} from './team-composer'

const BOTH: TuiAgent[] = ['claude', 'codex']
const isAgent = (v: string): v is TuiAgent => ['claude', 'codex', 'gemini'].includes(v)

describe('defaultAgentForRole', () => {
  it('uses Claude for builders and Codex for reviewers when installed', () => {
    expect(defaultAgentForRole('frontend', BOTH, {})).toBe('claude')
    expect(defaultAgentForRole('review', BOTH, {})).toBe('codex')
  })
  it('falls back when Codex is not installed, and honours the saved map', () => {
    expect(defaultAgentForRole('review', ['claude'], {})).toBe('claude')
    expect(defaultAgentForRole('docs', BOTH, { docs: 'codex' })).toBe('codex')
    expect(defaultAgentForRole('docs', ['gemini' as TuiAgent], { docs: 'codex' })).toBe('gemini')
    expect(defaultAgentForRole('docs', [], {})).toBeNull()
  })
})

describe('team slots', () => {
  it('starts with the requested count, capped at 12', () => {
    expect(initialTeam(4, BOTH, {})).toHaveLength(4)
    expect(initialTeam(40, BOTH, {})).toHaveLength(TEAM_MAX_SLOTS)
    expect(initialTeam(4, [], {})).toEqual([])
  })
  it('a role change pre-selects that role default; the agent can still be changed', () => {
    let slots = initialTeam(2, BOTH, {})
    slots = setSlotRole(slots, 1, 'review', BOTH, {})
    expect(slots[1]).toEqual({ role: 'review', agent: 'codex' })
    slots = setSlotAgent(slots, 1, 'claude')
    expect(slots[1]).toEqual({ role: 'review', agent: 'claude' })
    expect(slots[0]).toEqual({ role: 'general', agent: 'claude' })
  })
  it('adds up to 12 and never removes the last slot', () => {
    let slots = initialTeam(1, BOTH, {})
    for (let i = 0; i < 20; i += 1) {
      slots = addSlot(slots, BOTH, {})
    }
    expect(slots).toHaveLength(12)
    expect(removeSlot(initialTeam(1, BOTH, {}), 0)).toHaveLength(1)
    expect(removeSlot(slots, 0)).toHaveLength(11)
  })
})

describe('saved role map', () => {
  it('remembers chosen agents and round-trips through storage text', () => {
    const map = rememberRoleAgents({}, [
      { role: 'review', agent: 'claude' },
      { role: 'docs', agent: 'codex' }
    ])
    expect(parseRoleAgentMap(JSON.stringify(map), isAgent)).toEqual(map)
  })
  it('ignores junk', () => {
    expect(parseRoleAgentMap('not json', isAgent)).toEqual({})
    expect(parseRoleAgentMap('{"review":"rm -rf","ghost":"claude"}', isAgent)).toEqual({})
    expect(parseRoleAgentMap(null, isAgent)).toEqual({})
  })
})

describe('fillAllSlots', () => {
  it('sets every slot to one agent and keeps roles', () => {
    const team = setSlotRole(initialTeam(3, BOTH, {}), 1, 'review', BOTH, {})
    expect(team[1].agent).toBe('codex')
    const filled = fillAllSlots(team, 'claude')
    expect(filled.map((s) => s.agent)).toEqual(['claude', 'claude', 'claude'])
    expect(filled.map((s) => s.role)).toEqual(['general', 'review', 'general'])
  })
})

describe('resizeTeam', () => {
  it('grows by copying the last role and trims from the end', () => {
    const team = setSlotRole(initialTeam(2, BOTH, {}), 1, 'review', BOTH, {})
    const grown = resizeTeam(team, 4, BOTH, {})
    expect(grown).toHaveLength(4)
    expect(grown.slice(2)).toEqual([
      { role: 'review', agent: 'codex' },
      { role: 'review', agent: 'codex' }
    ])
    expect(resizeTeam(grown, 1, BOTH, {})).toEqual([team[0]])
  })

  it('clamps to 1-12 and leaves an empty team alone', () => {
    const team = initialTeam(3, BOTH, {})
    expect(resizeTeam(team, 0, BOTH, {})).toHaveLength(1)
    expect(resizeTeam(team, 99, BOTH, {})).toHaveLength(TEAM_MAX_SLOTS)
    expect(resizeTeam(team, Number.NaN, BOTH, {})).toHaveLength(3)
    expect(resizeTeam([], 5, BOTH, {})).toEqual([])
  })
})

describe('teamGroupName', () => {
  it('trims and collapses whitespace, null when blank', () => {
    expect(teamGroupName('  Docs   crew ')).toBe('Docs crew')
    expect(teamGroupName('   ')).toBeNull()
    expect(teamGroupName('x'.repeat(80))).toHaveLength(60)
  })
})
