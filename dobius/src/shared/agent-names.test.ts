import { describe, expect, it } from 'vitest'
import { detectAgentStatusFromTitle } from './agent-detection'
import { isShellProcess } from './shell-process-detection'
import { resolveExplicitTerminalTitleAgentType } from './terminal-title-agent-type'
import {
  AGENT_NAMES,
  AGENT_NAME_BANNED_WORDS,
  formatAgentTabLabel,
  pickAgentName
} from './agent-names'

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
      diagonal = above
    }
  }
  return row[b.length]
}

/** Deterministic stand-in for Math.random. */
function sequence(...values: number[]): () => number {
  let index = 0
  return () => values[index++ % values.length]
}

describe('agent name library', () => {
  const lower = AGENT_NAMES.map((name) => name.toLowerCase())

  it('holds about 300 short, single-word names', () => {
    expect(AGENT_NAMES.length).toBeGreaterThanOrEqual(280)
    for (const name of AGENT_NAMES) {
      expect(name).toMatch(/^[A-Z][a-z]{1,8}$/)
    }
  })

  it('has no duplicates, ignoring case', () => {
    expect(new Set(lower).size).toBe(AGENT_NAMES.length)
  })

  it('has no two names that are prefixes of each other or one letter apart', () => {
    const clashes: string[] = []
    for (let i = 0; i < lower.length; i += 1) {
      for (let j = i + 1; j < lower.length; j += 1) {
        const [a, b] = [lower[i], lower[j]]
        if (a.startsWith(b) || b.startsWith(a) || editDistance(a, b) <= 1) {
          clashes.push(`${AGENT_NAMES[i]}/${AGENT_NAMES[j]}`)
        }
      }
    }
    expect(clashes).toEqual([])
  })

  it('contains no banned word, shell name or agent-looking title', () => {
    const banned = new Set(AGENT_NAME_BANNED_WORDS)
    for (const name of AGENT_NAMES) {
      expect(banned.has(name.toLowerCase()), name).toBe(false)
      expect(isShellProcess(name), name).toBe(false)
      expect(detectAgentStatusFromTitle(name), name).toBeNull()
      expect(resolveExplicitTerminalTitleAgentType(name), name).toBeNull()
    }
  })
})

describe('pickAgentName', () => {
  it('is deterministic for an injected random source', () => {
    expect(pickAgentName([], () => 0)).toBe(AGENT_NAMES[0])
    expect(pickAgentName([], () => 0.999999)).toBe(AGENT_NAMES.at(-1))
    expect(pickAgentName([], sequence(0.5))).toBe(pickAgentName([], sequence(0.5)))
  })

  it('never returns a name already in use, ignoring case and spaces', () => {
    const used = [` ${AGENT_NAMES[0].toUpperCase()} `]
    expect(pickAgentName(used, () => 0)).toBe(AGENT_NAMES[1])
  })

  it('hands out every name once before repeating any', () => {
    const used: string[] = []
    for (let i = 0; i < AGENT_NAMES.length; i += 1) {
      used.push(pickAgentName(used, Math.random))
    }
    expect(new Set(used).size).toBe(AGENT_NAMES.length)
  })

  it('falls back to a numbered name when the library is exhausted', () => {
    const all = [...AGENT_NAMES]
    expect(pickAgentName(all, () => 0)).toBe(`${AGENT_NAMES[0]} 2`)
    expect(pickAgentName([...all, `${AGENT_NAMES[0]} 2`], () => 0)).toBe(`${AGENT_NAMES[0]} 3`)
  })

  it('tolerates an out-of-range random source', () => {
    expect(AGENT_NAMES).toContain(pickAgentName([], () => 1))
    expect(AGENT_NAMES).toContain(pickAgentName([], () => Number.NaN))
  })
})

describe('formatAgentTabLabel', () => {
  it('shows just the name when there is no live topic', () => {
    expect(formatAgentTabLabel('Juniper', '')).toBe('Juniper')
    expect(formatAgentTabLabel('Juniper', 'Juniper')).toBe('Juniper')
    expect(formatAgentTabLabel('Juniper', 'Terminal 3')).toBe('Juniper')
    expect(formatAgentTabLabel('Juniper', 'zsh')).toBe('Juniper')
    expect(formatAgentTabLabel('Juniper', '~/Projects/app')).toBe('Juniper')
    expect(formatAgentTabLabel('Juniper', 'carson@mac: ~/app')).toBe('Juniper')
  })

  it('puts the name before the live topic', () => {
    expect(formatAgentTabLabel('Juniper', 'Fix login bug')).toBe('Juniper · Fix login bug')
  })

  it('keeps an agent status glyph in front so status detection still works', () => {
    const label = formatAgentTabLabel('Juniper', '✳ Fix login bug')
    expect(label).toBe('✳ Juniper · Fix login bug')
    expect(detectAgentStatusFromTitle(label)).toBe('idle')
    expect(formatAgentTabLabel('Juniper', '✳ Claude Code')).toBe('✳ Juniper · Claude Code')
  })

  it('is idempotent', () => {
    const once = formatAgentTabLabel('Juniper', '✳ Fix login bug')
    expect(formatAgentTabLabel('Juniper', once)).toBe(once)
  })

  it('caps the label at the tab-title length', () => {
    const label = formatAgentTabLabel(
      'Juniper',
      'Refactor the authentication middleware to use tokens'
    )
    expect(label.length).toBeLessThanOrEqual(40)
    expect(label.startsWith('Juniper · Refactor')).toBe(true)
    expect(label.endsWith('…')).toBe(true)
  })

  it('returns the live title untouched for unnamed tabs', () => {
    expect(formatAgentTabLabel(undefined, '✳ Fix login bug')).toBe('✳ Fix login bug')
    expect(formatAgentTabLabel('  ', 'Terminal 2')).toBe('Terminal 2')
  })
})
