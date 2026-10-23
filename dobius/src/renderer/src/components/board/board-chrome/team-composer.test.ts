import { describe, expect, it } from 'vitest'
import type { TuiAgent } from '../../../../../shared/types'
import {
  TEAM_MAX_SLOTS,
  addSlot,
  defaultAgentForRole,
  initialTeam,
  parseRoleAgentMap,
  rememberRoleAgents,
  removeSlot,
  setSlotAgent,
  setSlotRole
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
