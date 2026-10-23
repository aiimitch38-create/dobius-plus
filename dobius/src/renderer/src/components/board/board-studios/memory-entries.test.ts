import { describe, expect, it } from 'vitest'
import {
  MEMORY_BRIEF_MAX_CHARS,
  MEMORY_FACT_MAX,
  buildMemoryBrief,
  buildRefreshPrompt,
  buildScanPrompt,
  classifyPushStatus,
  findByTitle,
  findDuplicate,
  parseProposals,
  sanitizeEntries,
  sanitizeMemoryByScope,
  type MemoryEntry
} from './memory-entries'

const entry = (id: string, fact: string, active = true): MemoryEntry => ({
  id,
  category: 'commands',
  title: `T ${id}`,
  fact,
  active
})

describe('sanitizeEntries', () => {
  it('drops malformed rows, clamps facts, defaults category and active', () => {
    const out = sanitizeEntries([
      { id: 'a', category: 'GOTCHAS', title: ' Build ', fact: 'x'.repeat(400) },
      { id: 'b', category: 'nope', title: 'T', fact: 'f', active: false },
      { title: 'no id', fact: 'f' },
      { id: 'c', title: '', fact: 'f' },
      { id: 'd', title: 'Draft', fact: '' },
      'junk'
    ])
    expect(out.map((e) => e.id)).toEqual(['a', 'b', 'd'])
    expect(out[0]).toMatchObject({ category: 'gotchas', title: 'Build', active: true })
    expect(out[0].fact).toHaveLength(MEMORY_FACT_MAX)
    expect(out[1]).toMatchObject({ category: 'context', active: false })
  })

  it('sanitizes a scope map and ignores non-objects', () => {
    expect(sanitizeMemoryByScope(null)).toEqual({})
    expect(sanitizeMemoryByScope({ r1: [entry('a', 'f')], r2: 'x' })).toEqual({
      r1: [entry('a', 'f')],
      r2: []
    })
  })
})

describe('duplicates and titles', () => {
  const entries = [entry('a', 'Run `pnpm test` before pushing.')]
  it('matches the same fact ignoring case and punctuation', () => {
    expect(findDuplicate(entries, { fact: 'run pnpm test before pushing' })?.id).toBe('a')
    expect(findDuplicate(entries, { fact: 'run pnpm lint' })).toBeNull()
  })
  it('finds a refresh target by title', () => {
    expect(findByTitle(entries, 't  A!')?.id).toBe('a')
  })
})

describe('parseProposals', () => {
  it('reads the object form and the bare-array form', () => {
    const obj = parseProposals(
      '{"proposals":[{"category":"commands","title":"Test","fact":"pnpm test"}]}'
    )
    expect(obj).toEqual([{ category: 'commands', title: 'Test', fact: 'pnpm test' }])
    expect(parseProposals('[{"title":"A","fact":"b"}]')).toEqual([
      { category: 'context', title: 'A', fact: 'b' }
    ])
  })
  it('recovers JSON wrapped in prose or a fence', () => {
    const text = 'Here:\n```json\n{"proposals":[{"title":"A","fact":"b"}]}\n```'
    expect(parseProposals(text)).toHaveLength(1)
  })
  it('returns null for unreadable output', () => {
    expect(parseProposals('no json here')).toBeNull()
    expect(parseProposals('{"other":1}')).toBeNull()
  })
})

describe('prompts', () => {
  it('scales the minimum with effort and names the proposals file', () => {
    expect(buildScanPrompt('quick')).toContain('at least 6')
    expect(buildScanPrompt('thorough')).toContain('at least 12')
    expect(buildScanPrompt('balanced')).toContain('.dobius/memory-proposals.json')
  })
  it('asks a refresh to answer the title as a question', () => {
    expect(buildRefreshPrompt('How do I build?')).toContain('"How do I build?"')
  })
})

describe('buildMemoryBrief', () => {
  it('sends only active entries, framed as background context', () => {
    const brief = buildMemoryBrief([entry('a', 'one'), entry('b', 'two', false)])
    expect(brief).toContain('not a task')
    expect(brief).toContain('one')
    expect(brief).not.toContain('two')
  })
  it('is empty when nothing is active', () => {
    expect(buildMemoryBrief([entry('a', 'x', false)])).toBe('')
  })
  it('truncates with a count of the rest', () => {
    const many = Array.from({ length: 200 }, (_, i) => entry(String(i), 'f'.repeat(200)))
    const brief = buildMemoryBrief(many)
    expect(brief.length).toBeLessThanOrEqual(MEMORY_BRIEF_MAX_CHARS + 40)
    expect(brief).toMatch(/\(\d+ more entries not shown\)$/)
  })
})

describe('classifyPushStatus', () => {
  it('buckets notes-send statuses', () => {
    expect(classifyPushStatus('sent')).toBe('sent')
    expect(classifyPushStatus('permission')).toBe('busy')
    expect(classifyPushStatus('no-agent')).toBe('shell')
    expect(classifyPushStatus('no-active-terminal')).toBe('failed')
  })
})
