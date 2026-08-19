import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({ userDataDir: '' }))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => electronMock.userDataDir) }
}))

async function loadStore() {
  vi.resetModules()
  return import('./observer-channel-index-store')
}

beforeEach(() => {
  electronMock.userDataDir = mkdtempSync(path.join(tmpdir(), 'dobius-observer-index-'))
})

afterEach(() => {
  rmSync(electronMock.userDataDir, { recursive: true, force: true })
})

describe('observer channel index store', () => {
  it('returns nothing for a channel with no indexed frames', async () => {
    const store = await loadStore()
    expect(store.readIndexedEventsForChannel('channel-1')).toEqual([])
  })

  it('indexes entries and reads them back newest-first for the right channel', async () => {
    const store = await loadStore()
    store.indexObserverChannelIds([
      { eventId: 'evt-1', channelId: 'channel-1', createdAt: 100 },
      { eventId: 'evt-2', channelId: 'channel-1', createdAt: 200 },
      { eventId: 'evt-3', channelId: 'channel-2', createdAt: 300 }
    ])
    const page = store.readIndexedEventsForChannel('channel-1')
    expect(page.map((e) => e.eventId)).toEqual(['evt-2', 'evt-1'])
  })

  it('is idempotent — re-indexing an existing eventId does not overwrite it', async () => {
    const store = await loadStore()
    store.indexObserverChannelIds([{ eventId: 'evt-1', channelId: 'channel-1', createdAt: 100 }])
    store.indexObserverChannelIds([{ eventId: 'evt-1', channelId: 'channel-9', createdAt: 999 }])
    expect(store.readIndexedEventsForChannel('channel-1')).toHaveLength(1)
    expect(store.readIndexedEventsForChannel('channel-9')).toHaveLength(0)
  })

  it('pages using a compound cursor', async () => {
    const store = await loadStore()
    store.indexObserverChannelIds([
      { eventId: 'evt-a', channelId: 'c', createdAt: 300 },
      { eventId: 'evt-b', channelId: 'c', createdAt: 200 },
      { eventId: 'evt-c', channelId: 'c', createdAt: 100 }
    ])
    const firstPage = store.readIndexedEventsForChannel('c', { limit: 2 })
    expect(firstPage.map((e) => e.eventId)).toEqual(['evt-a', 'evt-b'])
    const cursor = { createdAt: firstPage[1].createdAt, id: firstPage[1].eventId }
    const secondPage = store.readIndexedEventsForChannel('c', { before: cursor, limit: 2 })
    expect(secondPage.map((e) => e.eventId)).toEqual(['evt-c'])
  })

  it('drops malformed entries and unscoped (null channelId) entries never match a channel query', async () => {
    const store = await loadStore()
    store.indexObserverChannelIds([
      { eventId: 'evt-null', channelId: null, createdAt: 100 },
      { eventId: '', channelId: 'c', createdAt: 100 }
    ])
    expect(store.readIndexedEventsForChannel('c')).toEqual([])
  })
})
