// Review fixes: secrets split across chunks or hidden in titles, provider
// prefixes, document budgets, disk limits and the refresh worker job.
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chunkSections, DOCUMENT_MAX_CHARS, RecentSections } from './library-chunk'
import { MIN_FREE_DISK_BYTES, refreshLibrary } from './library-indexer'
import { runRefreshJob } from './library-refresh-job'
import { defaultLibraryRoots } from './library-roots'
import { searchLibrary } from './library-search'
import { scrubText } from './library-secrets'
import { docKeyId, runTransaction, SCHEMA_VERSION } from './library-schema'
import { LIBRARY_STOP_WAIT_MS, LibraryService } from './library-service'
import SyncDatabase from '../sqlite/sync-database'
import { obsidianIngester } from './sources/obsidian'
import { streamHash } from './sources/project-checkouts'
import { openSafe } from './sources/safe-path'
import { LibraryStore } from './library-store'
import type { LibraryCandidate, LibraryDocument, LibraryIngester } from './library-types'

let dir: string
let store: LibraryStore
const plenty = { yieldNow: () => Promise.resolve(), freeBytes: async () => 1e12 }
const FAKE_KEY = `sk-proj-${'Z1x2C3v4'.repeat(5)}`

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'library-hardening-')))
  store = new LibraryStore(join(dir, 'library.sqlite'))
})
afterEach(() => {
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

function source(docs: Record<string, LibraryDocument>, mtimeMs = 1000): LibraryIngester {
  return {
    source: 'project',
    list: async () =>
      Object.entries(docs).map<LibraryCandidate>(([key, doc], i) => ({
        key,
        source: 'project',
        path: `/fixture/${key}`,
        mtimeMs: mtimeMs + i,
        size: 1,
        load: async () => doc
      }))
  }
}

const doc = (text: string, title = 'Note', project: string | null = 'Epoxy'): LibraryDocument => ({
  project,
  title,
  sections: [{ text, at: 1 }]
})

function storedText(): string {
  const rows = store.db.prepare('SELECT title, project, path FROM docs').all() as Record<string, string>[]
  const chunks = store.db.prepare('SELECT text FROM chunks').all() as { text: string }[]
  return JSON.stringify([rows, chunks])
}

describe('secrets split by a chunk boundary', () => {
  it('redacts a value whose label ends the previous chunk', async () => {
    const filler = 'notes about the deploy plan and the quote form '.repeat(31).slice(0, 1490)
    const inline = `${filler} password: hunterSECRETvalue42 and more words after it ${'x y '.repeat(200)}`
    const twoLines = `${filler}\npassword:\nhunterSECRETnextline9\n${'more ordinary notes here '.repeat(80)}`
    await refreshLibrary(store, [source({ inline: doc(inline), twoLines: doc(twoLines) })], { capBytes: 1e9, ...plenty })
    expect(storedText()).not.toContain('hunterSECRET')
    expect(searchLibrary(store, { query: 'hunterSECRETvalue42' })).toEqual([])
    expect(searchLibrary(store, { query: 'deploy plan' }).length).toBeGreaterThan(0)
  })
})

describe('titles and project names', () => {
  it('are scrubbed before they are stored or indexed', async () => {
    await refreshLibrary(
      store,
      [source({ titled: doc('ordinary body text', `Setup with ${FAKE_KEY}`, `proj ${FAKE_KEY}`) })],
      { capBytes: 1e9, ...plenty }
    )
    expect(storedText()).not.toContain(FAKE_KEY)
    expect(searchLibrary(store, { query: FAKE_KEY.slice(8, 20) })).toEqual([])
    expect(searchLibrary(store, { query: 'ordinary' })[0].title).toContain('Setup with')
  })
})

describe('provider prefixes', () => {
  it('drops an ek_ token with an all-letter payload', () => {
    const line = `voice key ek_${'abcdefghij'.repeat(4)} for the call`
    expect(scrubText(line).text).toBe('')
  })
})

describe('document budgets', () => {
  it('cuts one huge section to the per-document budget', () => {
    const chunks = chunkSections([{ text: 'word '.repeat(1_600_000), at: 1 }])
    const total = chunks.reduce((sum, chunk) => sum + chunk.text.length, 0)
    expect(total).toBeLessThanOrEqual(DOCUMENT_MAX_CHARS)
  })

  it('keeps only the newest text of a long transcript', () => {
    const recent = new RecentSections(100)
    for (let i = 0; i < 50; i += 1) {
      recent.push({ text: `message ${i} ......`, at: i })
    }
    const total = recent.sections.reduce((sum, section) => sum + section.text.length, 0)
    expect(total).toBeLessThanOrEqual(100)
    expect(recent.sections.at(-1)?.text).toContain('message 49')
  })
})

describe('disk limits', () => {
  it('does not start a pass with under 2 GB free', async () => {
    const report = await refreshLibrary(store, [source({ a: doc('alpha') })], {
      capBytes: 1e9,
      yieldNow: () => Promise.resolve(),
      freeBytes: async () => MIN_FREE_DISK_BYTES - 1
    })
    expect(report.stopped).toMatch(/disk/)
    expect(report.indexed).toBe(0)
  })

  it('stops before a write that would leave under 2 GB free', async () => {
    const report = await refreshLibrary(store, [source({ a: doc('alpha '.repeat(5000)) })], {
      capBytes: 1e9,
      yieldNow: () => Promise.resolve(),
      freeBytes: async () => MIN_FREE_DISK_BYTES + 1000
    })
    expect(report).toMatchObject({ indexed: 0, removed: 0 })
    expect(report.stopped).toMatch(/disk/)
  })

  it('stops cleanly on a full disk, keeping earlier documents and re-reading the cut one later', async () => {
    const real = store.addChunks.bind(store)
    let calls = 0
    vi.spyOn(store, 'addChunks').mockImplementation((...args) => {
      calls += 1
      if (calls === 2) {
        throw Object.assign(new Error('database or disk is full'), { code: 'ERR_SQLITE_ERROR' })
      }
      real(...args)
    })
    const docs = { first: doc('first note kept'), second: doc('second note cut') }
    const report = await refreshLibrary(store, [source(docs)], { capBytes: 1e9, ...plenty })
    expect(report.stopped).toBe('the disk is full')
    expect(store.db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
    vi.restoreAllMocks()
    // The newest ("second", higher mtime) went first and was cut; it is re-read.
    const again = await refreshLibrary(store, [source(docs)], { capBytes: 1e9, ...plenty })
    expect(again.indexed).toBe(1)
    expect(searchLibrary(store, { query: 'second' })).toHaveLength(1)
  })

  it('counts the WAL toward the size', () => {
    store.putDoc({ key: 'k', source: 'project', project: null, path: '/k', title: 't', mtimeMs: 1, size: 1, kind: 'reference' }, [{ text: 'x '.repeat(50_000), at: 1 }])
    expect(store.walBytes()).toBeGreaterThan(0)
    expect(store.usedBytes()).toBeGreaterThanOrEqual(store.walBytes())
  })
})

describe('refresh job and service', () => {
  it('runs a pass with its own connection, readable from another', async () => {
    const userData = join(dir, 'userData')
    const roots = { ...defaultLibraryRoots(userData, join(dir, 'home')) }
    mkdirSync(dirname(join(roots.obsidianVault, 'Note.md')), { recursive: true })
    writeFileSync(join(roots.obsidianVault, 'Note.md'), '# Gallery\nThe epoxy gallery page.')
    const report = await runRefreshJob({ dbPath: join(dir, 'job.sqlite'), roots, capBytes: 1e9 }, () => false)
    expect(report.indexed).toBe(1)
    const reader = new LibraryStore(join(dir, 'job.sqlite'))
    expect(searchLibrary(reader, { query: 'gallery' })[0].source).toBe('obsidian')
    reader.close()
  })

  it('never runs two passes at once, and stop asks the running pass to stop', async () => {
    let finish: (value: never) => void = () => undefined
    const stop = vi.fn(() => finish({ stopped: 'asked' } as never))
    const runPass = vi.fn(() => ({ done: new Promise<never>((resolve) => (finish = resolve)), stop }))
    const service = new LibraryService(join(dir, 'svc.sqlite'), defaultLibraryRoots(dir, dir), runPass)
    const first = service.refresh()
    expect(service.refresh()).toBe(first)
    expect(runPass).toHaveBeenCalledOnce()
    expect(service.status().refreshing).toBe(true)
    await service.stop()
    expect(stop).toHaveBeenCalledOnce()
  })
})

describe('second review: keys, safe reads, rollbacks, quit', () => {
  it('stores a hash, not the raw path, as the document key', async () => {
    const secretPath = `/fixture/${FAKE_KEY}/notes.md`
    const ingester: LibraryIngester = {
      source: 'project',
      list: async () => [
        { key: `project:${secretPath}`, source: 'project', path: secretPath, mtimeMs: 1, size: 1, load: async () => doc('plain body words') }
      ]
    }
    await refreshLibrary(store, [ingester], { capBytes: 1e9, ...plenty })
    const keys = store.db.prepare('SELECT key, path FROM docs').all() as { key: string; path: string }[]
    expect(JSON.stringify(keys)).not.toContain(FAKE_KEY)
    expect(keys[0].key).toBe(docKeyId(`project:${secretPath}`))
    // Unchanged on the next pass, and removed once the file is gone.
    expect((await refreshLibrary(store, [ingester], { capBytes: 1e9, ...plenty })).unchanged).toBe(1)
    const gone: LibraryIngester = { source: 'project', list: async () => [] }
    expect((await refreshLibrary(store, [gone], { capBytes: 1e9, ...plenty })).removed).toBe(1)
  })

  it('rebuilds a library from the old layout with raw keys', () => {
    const oldPath = join(dir, 'old.sqlite')
    const old = new SyncDatabase(oldPath)
    old.exec(`CREATE TABLE docs (id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, source TEXT NOT NULL,
      project TEXT, path TEXT NOT NULL, title TEXT NOT NULL, mtime_ms INTEGER NOT NULL, size INTEGER NOT NULL,
      evicted INTEGER NOT NULL DEFAULT 0, indexed_at INTEGER NOT NULL);
      INSERT INTO docs (key, source, path, title, mtime_ms, size, indexed_at) VALUES ('project:/raw/${FAKE_KEY}', 'project', '/raw', 't', 1, 1, 1);`)
    old.close()
    const upgraded = new LibraryStore(oldPath)
    expect(upgraded.db.prepare('SELECT COUNT(*) AS n FROM docs').get()).toEqual({ n: 0 })
    expect(upgraded.db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    upgraded.close()
  })

  it('keeps the disk-full error when SQLite already rolled back', () => {
    const full = new Error('database or disk is full')
    expect(() =>
      runTransaction(store.db, () => {
        store.db.exec('ROLLBACK')
        throw full
      })
    ).toThrow(full)
    // No transaction is left open: a new one starts fine.
    expect(runTransaction(store.db, () => 1)).toBe(1)
  })

  it('stops a pass cleanly when the store reports a full disk after an auto-rollback', async () => {
    vi.spyOn(store, 'addChunks').mockImplementation(() => {
      runTransaction(store.db, () => {
        store.db.exec('ROLLBACK')
        throw new Error('database or disk is full')
      })
    })
    const report = await refreshLibrary(store, [source({ a: doc('alpha'), b: doc('beta') })], { capBytes: 1e9, ...plenty })
    expect(report.stopped).toBe('the disk is full')
    expect(report.indexed).toBe(0)
    vi.restoreAllMocks()
  })

  it('refuses a read when a parent folder is swapped for a link after listing', async () => {
    const vault = join(dir, 'vault')
    mkdirSync(join(vault, 'sub'), { recursive: true })
    writeFileSync(join(vault, 'sub/Note.md'), '# Note\ninside')
    mkdirSync(join(dir, 'outside'), { recursive: true })
    writeFileSync(join(dir, 'outside/Note.md'), '# Outside\nnot in the vault')
    const [candidate] = await obsidianIngester(vault).list()
    expect(await streamHash(candidate.path, vault)).not.toBeNull()
    renameSync(join(vault, 'sub'), join(dir, 'moved'))
    symlinkSync(join(dir, 'outside'), join(vault, 'sub'))
    expect(await candidate.load()).toBeNull()
    expect(await streamHash(candidate.path, vault)).toBeNull()
    expect(await openSafe(candidate.path, vault)).toBeNull()
  })

  it('quit waits for a running pass, but no longer than the cap', async () => {
    vi.useFakeTimers()
    try {
      const stop = vi.fn()
      const runPass = vi.fn(() => ({ done: new Promise<never>(() => undefined), stop }))
      const service = new LibraryService(join(dir, 'quit.sqlite'), defaultLibraryRoots(dir, dir), runPass)
      void service.refresh()
      let stopped = false
      const stopping = service.stop().then(() => {
        stopped = true
      })
      await vi.advanceTimersByTimeAsync(LIBRARY_STOP_WAIT_MS - 100)
      expect(stopped).toBe(false)
      await vi.advanceTimersByTimeAsync(200)
      await stopping
      expect(stopped).toBe(true)
      expect(stop).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
})
