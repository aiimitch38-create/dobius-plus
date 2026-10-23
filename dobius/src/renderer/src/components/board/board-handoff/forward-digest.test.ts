import { describe, expect, it } from 'vitest'
import {
  HANDOFF_END,
  HANDOFF_START,
  extractHandoffBrief,
  forwardDigest,
  tabHasAgentStatus,
  splitForward
} from './forward-digest'

const replies = [
  { name: 'Claude 1', text: 'short' },
  { name: 'Codex 1', text: 'a much much longer reply text here' },
  { name: 'Claude 2', text: 'medium reply' }
]

describe('forwardDigest', () => {
  it('numbers each reply in order between a preface and a closing line', () => {
    const d = forwardDigest('Find the bug', replies, 'fix them')
    expect(d.indexOf('## 1. Claude 1')).toBeLessThan(d.indexOf('## 2. Codex 1'))
    expect(d).toContain('Find the bug')
    expect(d).toContain('fix them')
    expect(d.trim().endsWith('End of forwarded results.')).toBe(true)
  })
})

describe('splitForward', () => {
  it('never makes more parts than replies and keeps every reply exactly once', () => {
    const parts = splitForward('Q', replies, 'go', ['A', 'B', 'C', 'D'])
    expect(parts).toHaveLength(3)
    for (const r of replies) {
      expect(parts.filter((p) => p.includes(`. ${r.name}`))).toHaveLength(1)
    }
    expect(parts[0]).toMatch(/B, C have the rest/)
  })

  it('balances by length: the long reply sits alone when there are two parts', () => {
    const parts = splitForward('Q', replies, 'go', ['A', 'B'])
    const withLong = parts.find((p) => p.includes('Codex 1'))!
    expect(withLong).not.toContain('Claude 1')
    expect(splitForward('Q', replies, 'go', ['Solo'])).toHaveLength(1)
    expect(splitForward('Q', [], 'go', ['A'])).toEqual([])
  })
})

describe('extractHandoffBrief', () => {
  it('takes the text between the last markers, else the whole reply', () => {
    expect(extractHandoffBrief(`noise\n${HANDOFF_START}\nGoal: X\n${HANDOFF_END}\n`)).toBe(
      'Goal: X'
    )
    expect(extractHandoffBrief('just a summary')).toBe('just a summary')
    expect(extractHandoffBrief('  ')).toBeNull()
    expect(extractHandoffBrief(null)).toBeNull()
  })
})

describe('tabHasAgentStatus', () => {
  it('matches only panes of that tab', () => {
    expect(tabHasAgentStatus({ 'tab-1:leaf': {} }, 'tab-1')).toBe(true)
    expect(tabHasAgentStatus({ 'tab-10:leaf': {} }, 'tab-1')).toBe(false)
    expect(tabHasAgentStatus({}, 'tab-1')).toBe(false)
  })
})
