// The live voice's look-up: every-word search, and owning up to an unready index.
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { lookUpInLibrary } from './library-app'
import { MIN_FREE_DISK_BYTES, refreshLibrary } from './library-indexer'
import { defaultLibraryRoots } from './library-roots'
import { searchLibrary } from './library-search'
import { LibraryService } from './library-service'
import { LibraryStore } from './library-store'
import type { LibraryIngester } from './library-types'

let dir: string
let dbPath: string
const notes: LibraryIngester = {
  source: 'project',
  list: async () => [
    {
      key: 'project:a',
      source: 'project',
      path: '/fixture/a.md',
      mtimeMs: 1,
      size: 1,
      load: async () => ({ project: 'Epoxy', title: 'Plan', sections: [{ text: 'the gallery ships friday', at: 1 }] })
    }
  ]
}

async function refresh(freeBytes: number): Promise<void> {
  const store = new LibraryStore(dbPath)
  await refreshLibrary(store, [notes], { capBytes: 1e9, yieldNow: () => Promise.resolve(), freeBytes: async () => freeBytes })
  store.close()
}

const service = (): LibraryService =>
  new LibraryService(dbPath, defaultLibraryRoots(dir, dir), () => {
    throw new Error('no pass in this test')
  })

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'library-lookup-')))
  dbPath = join(dir, 'library.sqlite')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('library look-up', () => {
  it('is null until a first pass has ended', async () => {
    const library = service()
    expect(library.lookUp({ query: 'gallery' })).toBeNull()
    await library.stop()
  })

  it('finds a passage, and everyWord drops the any-word fallback', async () => {
    await refresh(1e12)
    const library = service()
    expect(library.lookUp({ query: 'gallery' })?.[0].title).toBe('Plan')
    expect(library.lookUp({ query: 'gallery zebra' })).toHaveLength(1)
    expect(library.lookUp({ query: 'gallery zebra', everyWord: true })).toEqual([])
    await library.stop()
    const store = new LibraryStore(dbPath)
    expect(searchLibrary(store, { query: 'gallery friday', everyWord: true })).toHaveLength(1)
    store.close()
  })

  it('everyWord needs the words in the passage, not only in the title', async () => {
    const titled: LibraryIngester = {
      source: 'project',
      list: async () => [
        {
          key: 'project:t',
          source: 'project',
          path: '/fixture/t.md',
          mtimeMs: 1,
          size: 1,
          load: async () => ({ project: null, title: 'the weather in Dallas', sections: [{ text: 'unrelated grocery list', at: 1 }] })
        }
      ]
    }
    const store = new LibraryStore(dbPath)
    await refreshLibrary(store, [titled], { capBytes: 1e9, yieldNow: () => Promise.resolve(), freeBytes: async () => 1e12 })
    expect(store.fts).toBe(true)
    expect(searchLibrary(store, { query: 'the weather in dallas' })).toHaveLength(1)
    expect(searchLibrary(store, { query: 'the weather in dallas', everyWord: true })).toEqual([])
    expect(searchLibrary(store, { query: 'grocery list', everyWord: true })).toHaveLength(1)
    store.close()
  })

  it('is null, not "nothing matches", when the last pass stopped early on low disk', async () => {
    await refresh(MIN_FREE_DISK_BYTES - 1)
    const library = service()
    expect(library.lastRefresh()?.stopped).toBeTruthy()
    expect(library.lookUp({ query: 'gallery' })).toBeNull()
    await library.stop()
  })

  it('is null when the library is switched off, without opening it', () => {
    expect(lookUpInLibrary({ query: 'gallery' }, { DOBIUS_LIBRARY_DISABLED: '1' })).toBeNull()
    expect(lookUpInLibrary({ query: 'gallery' }, { DOBIUS_E2E_USER_DATA_DIR: dir })).toBeNull()
  })
})
