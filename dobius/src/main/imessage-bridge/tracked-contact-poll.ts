// Text intake's reader (7.17), run inside the bridge's own poll on the bridge's
// own chat.db handle: no second reader. Same at-most-once rule as the self-chat
// watermark: lastSeenContactRowid moves past a row BEFORE it is handled, and
// jumps to the newest row on every bridge start, so history is never read.
// The SQL only returns rows FROM a tracked handle, so nobody else's text ever
// leaves chat.db.
import type SyncDatabase from '../sqlite/sync-database'
import { getImessageBridgeConfig, updateImessageBridgeConfig } from './bridge-config'
import { extractChatDbMessageText } from './chat-db-message-text'

// Incoming (is_from_me = 0) rows from an exact tracked handle spelling, 1:1
// chats only (group guids carry ';+;'; never a substring match), and only rows
// after the row that contact's tracking began at: adding a contact while the
// mark sits behind never imports their older history.
const TRACKED_SQL = `
  SELECT message.ROWID AS rowid,
         message.guid AS guid,
         message.text AS text,
         message.attributedBody AS attributedBody,
         handle.id AS handle
  FROM message
  JOIN handle ON message.handle_id = handle.ROWID
  JOIN json_each(?) AS tracked
    ON lower(handle.id) = json_extract(tracked.value, '$.spelling')
  LEFT JOIN chat_message_join ON message.ROWID = chat_message_join.message_id
  LEFT JOIN chat ON chat_message_join.chat_id = chat.ROWID
  WHERE message.ROWID > ?
    AND message.is_from_me = 0
    AND message.ROWID > json_extract(tracked.value, '$.start')
    AND (chat.ROWID IS NULL OR instr(chat.guid, ';+;') = 0)
  GROUP BY message.ROWID
  ORDER BY message.ROWID ASC
  LIMIT 50
`

type TrackedRow = {
  rowid: number
  guid: string | null
  text: string | null
  attributedBody: Uint8Array | null
  handle: string
}

export type TrackedContactSink = {
  /** Exact lower-cased chat.db spellings of tracked handles, each with its contact's start row. */
  trackedSpellings: () => { spelling: string; start: number }[]
  /** True while a newly tracked contact has no start row yet. */
  needsStart: () => boolean
  startTracking: (newestRowid: number) => void
  ingest: (message: { messageId: string; handle: string; text: string }) => unknown
}

function newestRowid(database: SyncDatabase.Database): number {
  const row = database.prepare('SELECT COALESCE(MAX(ROWID), 0) AS maxRowid FROM message').get() as {
    maxRowid: number
  }
  return row.maxRowid
}

/** One pass over new texts from tracked contacts. `sink` null = intake not started yet. */
export function pollTrackedContacts(database: SyncDatabase.Database, sink: TrackedContactSink | null): void {
  if (!sink) {
    return
  }
  if (sink.needsStart()) {
    sink.startTracking(newestRowid(database))
  }
  const spellings = sink.trackedSpellings()
  if (spellings.length === 0) {
    // Why: nobody tracked yet, so keep the mark current; adding a contact later never reads history.
    // Only written when it moved, so an idle bridge never rewrites its file every poll.
    const newest = newestRowid(database)
    if (newest !== getImessageBridgeConfig().lastSeenContactRowid) {
      updateImessageBridgeConfig({ lastSeenContactRowid: newest })
    }
    return
  }
  const from = getImessageBridgeConfig().lastSeenContactRowid ?? 0
  const rows = database.prepare(TRACKED_SQL).all(JSON.stringify(spellings), from) as TrackedRow[]
  for (const row of rows) {
    updateImessageBridgeConfig({ lastSeenContactRowid: row.rowid })
    const text = extractChatDbMessageText(row)?.trim()
    if (!text) {
      continue
    }
    try {
      sink.ingest({ messageId: row.guid || `rowid:${row.rowid}`, handle: row.handle, text })
    } catch (error) {
      console.warn(
        `[imessage-bridge] tracked text ${row.rowid} not kept:`,
        error instanceof Error ? error.message : String(error)
      )
    }
  }
}
