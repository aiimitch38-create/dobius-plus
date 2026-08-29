import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AdamMemory, MAX_KEY_CHARS, MAX_TOTAL_CHARS, MAX_VALUE_CHARS } from './adam-memory'

function memoryFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'adammem-')), 'adam-memory.json')
}

function cost(memory: AdamMemory): number {
  return memory.list().reduce((sum, entry) => sum + entry.key.length + entry.value.length, 0)
}

/** A clock that advances one second per call, so updatedAt order is decidable. */
function tickingClock(): () => number {
  let now = 1_000
  return () => (now += 1_000)
}

describe('AdamMemory — round trip', () => {
  it('remembers and reads back', () => {
    const memory = new AdamMemory(memoryFile())
    expect(memory.remember('relationships', 'wife', 'Ashley')).toEqual({ ok: true })
    expect(memory.list()).toHaveLength(1)
    expect(memory.format()).toContain('wife: Ashley')
    expect(memory.format()).toContain('relationships:')
  })

  it('formats nothing when empty', () => {
    expect(new AdamMemory(memoryFile()).format()).toBe('')
  })

  it('updates a key in place rather than storing it twice', () => {
    const memory = new AdamMemory(memoryFile())
    memory.remember('preferences', 'editor', 'vim')
    memory.remember('preferences', 'editor', 'zed')
    expect(memory.list()).toHaveLength(1)
    expect(memory.list()[0].value).toBe('zed')
  })

  it('treats keys differing only by case or spacing as one fact', () => {
    const memory = new AdamMemory(memoryFile())
    memory.remember('relationships', 'Wife', 'Ashley')
    memory.remember('relationships', '  wife ', 'Ash')
    expect(memory.list()).toHaveLength(1)
    expect(memory.list()[0].value).toBe('Ash')
  })
})

describe('AdamMemory — refusals', () => {
  it('refuses an unknown category and names the valid ones', () => {
    const result = new AdamMemory(memoryFile()).remember('misc', 'x', 'y')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('identity')
      expect(result.error).toContain('notes')
    }
  })

  it('refuses an oversized value instead of truncating it', () => {
    const memory = new AdamMemory(memoryFile())
    const result = memory.remember('notes', 'long', 'x'.repeat(MAX_VALUE_CHARS + 1))
    expect(result.ok).toBe(false)
    // Half a fact read back as a whole one is worse than no fact at all.
    expect(memory.list()).toHaveLength(0)
  })

  it('refuses an empty key or value', () => {
    const memory = new AdamMemory(memoryFile())
    expect(memory.remember('notes', '   ', 'y').ok).toBe(false)
    expect(memory.remember('notes', 'k', '   ').ok).toBe(false)
  })

  it('refuses an oversized key, so one entry cannot exceed the total cap alone', () => {
    // Regression: entryCost counts the key, and an uncapped key made ONE entry
    // cost 10,001 against the 2,200 cap. Eviction could not clear it — nothing
    // else was left to drop — so format() then pushed the entire machine state
    // out of the agent payload and blew the 8,000-char budget (measured: 10,048).
    const memory = new AdamMemory(memoryFile())
    const result = memory.remember('notes', 'k'.repeat(MAX_KEY_CHARS + 1), 'v')
    expect(result.ok).toBe(false)
    expect(memory.list()).toHaveLength(0)
  })

  it('keeps one entry inside the total cap even at both maximums', () => {
    const memory = new AdamMemory(memoryFile())
    expect(memory.remember('notes', 'k'.repeat(MAX_KEY_CHARS), 'v'.repeat(MAX_VALUE_CHARS))).toEqual(
      { ok: true }
    )
    expect(cost(memory)).toBeLessThanOrEqual(MAX_TOTAL_CHARS)
  })
})

describe('AdamMemory — eviction', () => {
  it('drops oldest notes before anything else, and identity last', () => {
    const memory = new AdamMemory(memoryFile(), tickingClock())
    memory.remember('identity', 'name', 'Carson')
    memory.remember('notes', 'oldest-note', 'a'.repeat(300))
    memory.remember('notes', 'newer-note', 'b'.repeat(300))
    memory.remember('preferences', 'editor', 'zed')
    // Push well past the cap so several evictions must happen.
    for (let i = 0; i < 8; i += 1) {
      memory.remember('projects', `project-${i}`, 'p'.repeat(300))
    }

    const keys = memory.list().map((entry) => entry.key)
    expect(keys).toContain('name')
    expect(keys).not.toContain('oldest-note')
    expect(keys).not.toContain('newer-note')

    expect(cost(memory)).toBeLessThanOrEqual(MAX_TOTAL_CHARS)
  })

  it('evicts the older note first when both are notes', () => {
    const memory = new AdamMemory(memoryFile(), tickingClock())
    memory.remember('notes', 'first', 'a'.repeat(370))
    memory.remember('notes', 'second', 'b'.repeat(370))
    memory.remember('notes', 'third', 'c'.repeat(370))
    memory.remember('notes', 'fourth', 'd'.repeat(370))
    memory.remember('notes', 'fifth', 'e'.repeat(370))
    memory.remember('notes', 'sixth', 'f'.repeat(370))

    const keys = memory.list().map((entry) => entry.key)
    expect(keys).not.toContain('first')
    expect(keys).toContain('sixth')
  })

  it('never evicts the fact it was just asked to remember', () => {
    // Regression: with the store filled to 2,178 of 2,200 by `identity`, a new
    // `notes` entry was the ONLY candidate its own eviction pass would pick —
    // remember() returned ok:true, the IPC said "Saved. I'll remember that.",
    // and nothing was stored.
    const memory = new AdamMemory(memoryFile(), tickingClock())
    for (let i = 0; i < 6; i += 1) {
      memory.remember('identity', `id${i}`, 'x'.repeat(360))
    }
    expect(memory.remember('notes', 'brand-new-fact', 'z'.repeat(360))).toEqual({ ok: true })
    expect(memory.list().map((entry) => entry.key)).toContain('brand-new-fact')
    expect(cost(memory)).toBeLessThanOrEqual(MAX_TOTAL_CHARS)
  })

  it('never rejects a new fact for being over the total cap', () => {
    const memory = new AdamMemory(memoryFile(), tickingClock())
    for (let i = 0; i < 10; i += 1) {
      memory.remember('notes', `n${i}`, 'x'.repeat(370))
    }
    expect(memory.remember('identity', 'name', 'Carson')).toEqual({ ok: true })
    expect(memory.list().map((e) => e.key)).toContain('name')
  })
})

describe('AdamMemory — forget', () => {
  it('removes a fact and reports an unknown key', () => {
    const memory = new AdamMemory(memoryFile())
    memory.remember('notes', 'disk', 'the disk was 98% full')
    expect(memory.forget('DISK')).toBe(true)
    expect(memory.list()).toHaveLength(0)
    expect(memory.forget('disk')).toBe(false)
  })
})

describe('AdamMemory — persistence', () => {
  it('a second instance on the same file sees the first one writes', () => {
    const file = memoryFile()
    new AdamMemory(file).remember('identity', 'name', 'Carson')
    expect(new AdamMemory(file).format()).toContain('name: Carson')
  })

  it('survives a forget across instances', () => {
    const file = memoryFile()
    const first = new AdamMemory(file)
    first.remember('notes', 'wrong', 'bad fact')
    first.forget('wrong')
    expect(new AdamMemory(file).list()).toHaveLength(0)
  })

  it('loads a corrupt file as empty rather than throwing', () => {
    const file = memoryFile()
    writeFileSync(file, '{not json', 'utf-8')
    // Throwing here would take the whole voice feature down at startup.
    expect(new AdamMemory(file).list()).toEqual([])
  })

  it('ignores entries with an unknown category on load', () => {
    const file = memoryFile()
    writeFileSync(
      file,
      JSON.stringify([
        { category: 'notes', key: 'good', value: 'kept', updatedAt: 1 },
        { category: 'misc', key: 'bad', value: 'dropped', updatedAt: 2 }
      ]),
      'utf-8'
    )
    expect(new AdamMemory(file).list().map((e) => e.key)).toEqual(['good'])
  })
})
