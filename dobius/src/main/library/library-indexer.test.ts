import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { refreshLibrary, walReserve } from './library-indexer'
import { queryTerms, searchLibrary, sourceCounts } from './library-search'
import { LibraryStore } from './library-store'
import type { LibraryCandidate, LibraryIngester, LibrarySource } from './library-types'

let dir: string
let store: LibraryStore
const noYield = { yieldNow: () => Promise.resolve() }
const FAKE_KEY = `sk-proj-${'Q7w8E9r0'.repeat(5)}`

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'library-index-'))
  store = new LibraryStore(join(dir, 'library.sqlite'))
})
afterEach(() => {
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

type Fake = { key: string; text: string; mtimeMs: number; size?: number; source?: LibrarySource; project?: string }

function ingester(items: Fake[], source: LibrarySource = 'project'): LibraryIngester & { loads: ReturnType<typeof vi.fn> } {
  const loads = vi.fn()
  return {
    source,
    loads,
    list: async () =>
      items.map<LibraryCandidate>((item) => ({
        key: item.key,
        source: item.source ?? source,
        path: `/fixture/${item.key}`,
        mtimeMs: item.mtimeMs,
        size: item.size ?? item.text.length,
        load: async () => {
          loads(item.key)
          return { project: item.project ?? 'Epoxy', title: `Title ${item.key}`, sections: [{ text: item.text, at: item.mtimeMs }] }
        }
      }))
  }
}

describe('refreshLibrary', () => {
  it('is incremental: unchanged files are not read again, changed ones are', async () => {
    const items: Fake[] = [
      { key: 'a', text: 'alpha notes about quotes', mtimeMs: 1000 },
      { key: 'b', text: 'beta notes about invoices', mtimeMs: 2000 }
    ]
    const first = ingester(items)
    expect((await refreshLibrary(store, [first], { capBytes: 1e9, ...noYield })).indexed).toBe(2)

    const second = ingester(items)
    const report = await refreshLibrary(store, [second], { capBytes: 1e9, ...noYield })
    expect(report).toMatchObject({ indexed: 0, unchanged: 2 })
    expect(second.loads).not.toHaveBeenCalled()

    const third = ingester([{ ...items[0], text: 'alpha notes rewritten', mtimeMs: 3000 }, items[1]])
    expect((await refreshLibrary(store, [third], { capBytes: 1e9, ...noYield })).indexed).toBe(1)
    expect(third.loads).toHaveBeenCalledWith('a')
    expect(searchLibrary(store, { query: 'rewritten' })).toHaveLength(1)
    expect(searchLibrary(store, { query: 'quotes' })).toHaveLength(0)
  })

  it('removes documents whose files are gone', async () => {
    await refreshLibrary(store, [ingester([{ key: 'a', text: 'gone soon', mtimeMs: 1 }])], { capBytes: 1e9, ...noYield })
    const report = await refreshLibrary(store, [ingester([])], { capBytes: 1e9, ...noYield })
    expect(report.removed).toBe(1)
    expect(searchLibrary(store, { query: 'gone' })).toEqual([])
  })

  it('never stores a mostly-secret chunk, and redacts keys in the rest', async () => {
    const dump = Array.from({ length: 6 }, (_, i) => `KEY_${i}=${FAKE_KEY}${i}`).join('\n')
    const report = await refreshLibrary(
      store,
      [ingester([{ key: 'env-dump', text: dump, mtimeMs: 1 }, { key: 'note', text: `deploy uses ${FAKE_KEY} today`, mtimeMs: 2 }])],
      { capBytes: 1e9, ...noYield }
    )
    expect(report.droppedChunks).toBe(1)
    const stored = store.db.prepare('SELECT text FROM chunks').all() as { text: string }[]
    expect(stored).toHaveLength(1)
    expect(stored.map((row) => row.text).join('\n')).not.toContain(FAKE_KEY)
    expect(stored[0].text).toContain('deploy uses')
  })

  it('evicts oldest first to stay under the cap, and does not re-read evicted files', async () => {
    const big = (word: string): string =>
      Array.from({ length: 20_000 }, (_, i) => `${word} t${i}`).join(' ')
    const items: Fake[] = Array.from({ length: 8 }, (_, i) => ({ key: `doc${i}`, text: big(`word${i}`), mtimeMs: (i + 1) * 1000 }))
    // Measure the full size in a scratch store, then cap at half of it.
    const scratch = new LibraryStore(join(dir, 'scratch.sqlite'))
    await refreshLibrary(scratch, [ingester(items)], { capBytes: 1e12, ...noYield })
    scratch.checkpoint()
    const capBytes = Math.round(scratch.usedBytes() / 2)
    scratch.close()
    const report = await refreshLibrary(store, [ingester(items)], { capBytes, ...noYield })
    // Pages stay under the cap minus the WAL's reserve; once checkpointed, file + WAL fit the cap.
    expect(store.pageBytes()).toBeLessThanOrEqual(capBytes - walReserve(capBytes))
    store.checkpoint()
    expect(store.usedBytes()).toBeLessThanOrEqual(capBytes)
    expect(report.evicted).toBeGreaterThan(0)
    expect(searchLibrary(store, { query: 'word7' })).toHaveLength(1)
    expect(searchLibrary(store, { query: 'word0' })).toHaveLength(0)

    const again = ingester(items)
    await refreshLibrary(store, [again], { capBytes, ...noYield })
    expect(again.loads).not.toHaveBeenCalled()
  })
})

describe('searchLibrary', () => {
  beforeEach(async () => {
    await refreshLibrary(
      store,
      [
        ingester([
          { key: 'plan', text: 'The library plan: index every conversation with FTS5 and BM25 ranking.', mtimeMs: 1, project: 'dobius-plus' },
          { key: 'aside', text: 'A passing mention of the library in a long note about lunch and errands and weather.', mtimeMs: 2, project: 'Errands' }
        ]),
        ingester([{ key: 'chat', text: 'User: running the tests now\nClaude: all tests pass', mtimeMs: 3, project: 'epoxyitright' }], 'claude')
      ],
      { capBytes: 1e9, ...noYield }
    )
  })

  it('ranks by BM25, stems words and returns short snippets', () => {
    const hits = searchLibrary(store, { query: 'library conversation ranking' })
    expect(hits[0].title).toBe('Title plan')
    expect(hits[0].snippet.length).toBeLessThanOrEqual(300)
    expect(hits[0]).toMatchObject({ source: 'project', project: 'dobius-plus', path: '/fixture/plan' })
    expect(searchLibrary(store, { query: 'run test' })[0].title).toBe('Title chat')
  })

  it('falls back to any word when no passage has all of them', () => {
    expect(searchLibrary(store, { query: 'lunch zebra' }).map((hit) => hit.title)).toEqual(['Title aside'])
  })

  it('filters by source and by part of a project name', () => {
    expect(searchLibrary(store, { query: 'tests', source: 'project' })).toEqual([])
    expect(searchLibrary(store, { query: 'tests', project: 'EPOXY' })).toHaveLength(1)
    expect(searchLibrary(store, { query: 'library', project: 'dobius' }).map((hit) => hit.title)).toEqual(['Title plan'])
  })

  it('treats query syntax as plain words', () => {
    expect(queryTerms('"library" OR NEAR(x) -plan*')).toEqual(['library', 'or', 'near', 'x', 'plan'])
    expect(searchLibrary(store, { query: '***' })).toEqual([])
    expect(() => searchLibrary(store, { query: 'library") OR ("x' })).not.toThrow()
  })

  it('counts documents per source', () => {
    const counts = Object.fromEntries(sourceCounts(store).map((row) => [row.source, row.documents]))
    expect(counts).toMatchObject({ project: 2, claude: 1, codex: 0 })
  })
})
