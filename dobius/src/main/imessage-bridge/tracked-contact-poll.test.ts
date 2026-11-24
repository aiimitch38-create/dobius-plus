import { beforeEach, describe, expect, it, vi } from 'vitest'
import SyncDatabase from '../sqlite/sync-database'

const mocks = vi.hoisted(() => ({ config: { lastSeenContactRowid: 0 } as { lastSeenContactRowid?: number } }))

vi.mock('./bridge-config', () => ({
  getImessageBridgeConfig: () => ({ ...mocks.config }),
  updateImessageBridgeConfig: (updates: Partial<typeof mocks.config>) => {
    mocks.config = { ...mocks.config, ...updates }
    return { ...mocks.config }
  }
}))

import { pollTrackedContacts, type TrackedContactSink } from './tracked-contact-poll'

// A chat.db fixture in memory: handle 1 is tracked (Brett), handle 2 is not.
function seed(): SyncDatabase.Database {
  const db = new SyncDatabase(':memory:')
  db.exec(`
    CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);
    CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, guid TEXT, chat_identifier TEXT);
    CREATE TABLE message (
      ROWID INTEGER PRIMARY KEY, guid TEXT, text TEXT, attributedBody BLOB,
      is_from_me INTEGER, handle_id INTEGER
    );
    CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
    INSERT INTO handle (ROWID, id) VALUES (1, '+15550102000'), (2, '+15559999999');
    INSERT INTO chat (ROWID, guid, chat_identifier) VALUES
      (10, 'iMessage;-;+15550102000', '+15550102000'),
      (11, 'iMessage;-;+15559999999', '+15559999999'),
      (12, 'iMessage;+;chat42', 'chat42');
  `)
  const add = (rowid: number, text: string, handleId: number, fromMe: number, chatId: number): void => {
    db.prepare('INSERT INTO message VALUES (?, ?, ?, NULL, ?, ?)').run(rowid, `guid-${rowid}`, text, fromMe, handleId)
    db.prepare('INSERT INTO chat_message_join VALUES (?, ?)').run(chatId, rowid)
  }
  add(1, 'Brett: can you call me?', 1, 0, 10)
  add(2, 'stranger secret words', 2, 0, 11)
  add(3, 'Carson to Brett', 1, 1, 10)
  add(4, 'Brett in a group', 1, 0, 12)
  add(5, 'Brett again', 1, 0, 10)
  return db
}

type Seen = { messageId: string; handle: string; text: string }

/** A sink tracking `spellings`, each already started at `start` (or never started when null). */
function sink(spellings: string[], start: number | null = 0): TrackedContactSink & { seen: Seen[]; started: number[] } {
  const seen: Seen[] = []
  const started: number[] = []
  let begin = start
  return {
    seen,
    started,
    trackedSpellings: () => (begin === null ? [] : spellings.map((spelling) => ({ spelling, start: begin as number }))),
    needsStart: () => begin === null && spellings.length > 0,
    startTracking: (rowid) => {
      started.push(rowid)
      begin = rowid
    },
    ingest: (message) => seen.push(message)
  }
}

beforeEach(() => {
  mocks.config = { lastSeenContactRowid: 0 }
})

describe('tracked-contact poll', () => {
  it('reads only incoming 1:1 texts from tracked handles; strangers never leave chat.db', () => {
    const tracked = sink(['+15550102000'])
    pollTrackedContacts(seed(), tracked)
    expect(tracked.seen).toEqual([
      { messageId: 'guid-1', handle: '+15550102000', text: 'Brett: can you call me?' },
      { messageId: 'guid-5', handle: '+15550102000', text: 'Brett again' }
    ])
    expect(JSON.stringify(tracked.seen)).not.toContain('stranger')
    expect(mocks.config.lastSeenContactRowid).toBe(5)
  })

  it('is at-most-once: the mark moves before a row is handled, so a throw never replays it', () => {
    const db = seed()
    const marks: (number | undefined)[] = []
    const throwing: TrackedContactSink = {
      trackedSpellings: () => [{ spelling: '+15550102000', start: 0 }],
      needsStart: () => false,
      startTracking: () => undefined,
      ingest: () => {
        marks.push(mocks.config.lastSeenContactRowid)
        throw new Error('boom')
      }
    }
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    pollTrackedContacts(db, throwing)
    expect(marks).toEqual([1, 5])
    const again = sink(['+15550102000'])
    pollTrackedContacts(db, again)
    expect(again.seen).toEqual([])
  })

  it('with nobody tracked, keeps the mark at the newest row so history is never read later', () => {
    const db = seed()
    pollTrackedContacts(db, sink([]))
    expect(mocks.config.lastSeenContactRowid).toBe(5)
    const later = sink(['+15550102000'])
    pollTrackedContacts(db, later)
    expect(later.seen).toEqual([])
  })

  it('a newly tracked contact starts at the newest row: their older texts are never read', () => {
    const db = seed()
    mocks.config = { lastSeenContactRowid: 0 }
    const fresh = sink(['+15550102000'], null)
    pollTrackedContacts(db, fresh)
    expect(fresh.started).toEqual([5])
    expect(fresh.seen).toEqual([])
    db.prepare('INSERT INTO message VALUES (6, ?, ?, NULL, 0, 1)').run('guid-6', 'new one')
    db.prepare('INSERT INTO chat_message_join VALUES (10, 6)').run()
    pollTrackedContacts(db, fresh)
    expect(fresh.seen.map((m) => m.text)).toEqual(['new one'])
  })

  it('a contact whose start is ahead of the shared mark skips the rows in between', () => {
    const late = sink(['+15550102000'], 3)
    pollTrackedContacts(seed(), late)
    expect(late.seen.map((m) => m.messageId)).toEqual(['guid-5'])
  })

  it('does nothing before intake has started', () => {
    pollTrackedContacts(seed(), null)
    expect(mocks.config.lastSeenContactRowid).toBe(0)
  })
})
