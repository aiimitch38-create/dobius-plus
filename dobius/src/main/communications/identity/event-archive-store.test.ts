import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type * as Os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tempHome = ''

async function loadStoreModule() {
  vi.resetModules()
  vi.doMock('node:os', async () => {
    const actual = await vi.importActual<typeof Os>('node:os')
    return { ...actual, homedir: () => tempHome }
  })
  return import('./event-archive-store')
}

function sampleEvent(overrides: Partial<{ id: string; kind: number; createdAt: number }> = {}): string {
  return JSON.stringify({
    id: overrides.id ?? 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: overrides.createdAt ?? 1_700_000_000,
    kind: overrides.kind ?? 1,
    tags: [],
    content: 'hello',
    sig: 'c'.repeat(128)
  })
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'dobius-event-archive-'))
})

afterEach(() => {
  vi.doUnmock('node:os')
})

describe('event-archive-store', () => {
  it('persists new candidates and reports dropped for unparseable ones', async () => {
    const store = await loadStoreModule()
    const result = store.archiveEvents([
      { rawEventJson: sampleEvent({ id: 'e1'.padEnd(64, '0') }), matchedScope: { scopeType: 'channel_h', scopeValue: 'general' } },
      { rawEventJson: 'not json', matchedScope: { scopeType: 'channel_h', scopeValue: 'general' } }
    ])
    expect(result).toEqual({ persisted: 1, dropped: 1 })
  })

  it('is idempotent — re-archiving a known event id counts as dropped, not persisted', async () => {
    const store = await loadStoreModule()
    const candidate = {
      rawEventJson: sampleEvent({ id: 'e2'.padEnd(64, '0') }),
      matchedScope: { scopeType: 'owner_p' as const, scopeValue: 'owner-1' }
    }
    store.archiveEvents([candidate])
    const second = store.archiveEvents([candidate])
    expect(second).toEqual({ persisted: 0, dropped: 1 })
  })

  it('reads back a scoped, newest-first page and filters by kind', async () => {
    const store = await loadStoreModule()
    const scope = { scopeType: 'channel_h' as const, scopeValue: 'general' }
    store.archiveEvents([
      { rawEventJson: sampleEvent({ id: 'e3'.padEnd(64, '0'), kind: 1, createdAt: 100 }), matchedScope: scope },
      { rawEventJson: sampleEvent({ id: 'e4'.padEnd(64, '0'), kind: 7, createdAt: 200 }), matchedScope: scope },
      { rawEventJson: sampleEvent({ id: 'e5'.padEnd(64, '0'), kind: 1, createdAt: 300 }), matchedScope: scope }
    ])

    const all = store.readArchivedEvents('channel_h', 'general')
    expect(all.map((e) => e.id)).toEqual(['e5'.padEnd(64, '0'), 'e4'.padEnd(64, '0'), 'e3'.padEnd(64, '0')])

    const onlyKind1 = store.readArchivedEvents('channel_h', 'general', { kinds: [1] })
    expect(onlyKind1.map((e) => e.id)).toEqual(['e5'.padEnd(64, '0'), 'e3'.padEnd(64, '0')])
  })

  it('paginates with a compound (createdAt, id) cursor', async () => {
    const store = await loadStoreModule()
    const scope = { scopeType: 'referenced_e' as const, scopeValue: 'ref-1' }
    store.archiveEvents([
      { rawEventJson: sampleEvent({ id: 'e6'.padEnd(64, '0'), createdAt: 10 }), matchedScope: scope },
      { rawEventJson: sampleEvent({ id: 'e7'.padEnd(64, '0'), createdAt: 20 }), matchedScope: scope },
      { rawEventJson: sampleEvent({ id: 'e8'.padEnd(64, '0'), createdAt: 30 }), matchedScope: scope }
    ])

    const firstPage = store.readArchivedEvents('referenced_e', 'ref-1', { limit: 1 })
    expect(firstPage).toHaveLength(1)
    expect(firstPage[0].id).toBe('e8'.padEnd(64, '0'))

    const nextPage = store.readArchivedEvents('referenced_e', 'ref-1', {
      limit: 2,
      before: { createdAt: firstPage[0].created_at, id: firstPage[0].id }
    })
    expect(nextPage.map((e) => e.id)).toEqual(['e7'.padEnd(64, '0'), 'e6'.padEnd(64, '0')])
  })

  it('keeps different scopes fully isolated from each other', async () => {
    const store = await loadStoreModule()
    store.archiveEvents([
      {
        rawEventJson: sampleEvent({ id: 'e9'.padEnd(64, '0') }),
        matchedScope: { scopeType: 'channel_h', scopeValue: 'general' }
      }
    ])
    expect(store.readArchivedEvents('channel_h', 'other-channel')).toEqual([])
  })
})
