// Local archive of relay events, scoped by channel/owner/reference (the
// `archive_events` / `read_archived_events` Buzz commands). This is a
// separate concern from identity/key material — events are public relay
// data — but it lives in this package because the upstream coverage script
// (command-manifest.json) buckets it under "identity-keychain" (package 1).
// Storage is a small node:sqlite database via the project's existing
// SyncDatabase adapter (see src/main/sqlite/sync-database.ts), one file per
// machine at ~/.dobius/communications-event-archive.sqlite.
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import SyncDatabase from '../../sqlite/sync-database'

export type ArchiveScopeType = 'channel_h' | 'owner_p' | 'referenced_e'

export type ArchiveMatchedScope = {
  scopeType: ArchiveScopeType
  scopeValue: string
}

export type ArchiveCandidate = {
  rawEventJson: string
  matchedScope: ArchiveMatchedScope
}

export type ArchiveBatchResult = {
  persisted: number
  dropped: number
}

export type ArchivedRelayEvent = {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

export type ReadArchivedEventsOptions = {
  kinds?: number[] | null
  before?: { createdAt: number; id: string } | null
  limit?: number
}

const DEFAULT_PAGE_LIMIT = 50
const MAX_PAGE_LIMIT = 500

let db: SyncDatabase | null = null

function getDbPath(): string {
  const dir = join(homedir(), '.dobius')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return join(dir, 'communications-event-archive.sqlite')
}

function getDb(): SyncDatabase {
  if (db) {return db}
  db = new SyncDatabase(getDbPath())
  db.exec(`
    CREATE TABLE IF NOT EXISTS archived_events (
      id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL,
      scope_value TEXT NOT NULL,
      kind INTEGER NOT NULL,
      pubkey TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      raw_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_archived_events_scope
      ON archived_events(scope_type, scope_value, created_at DESC, id DESC);
  `)
  return db
}

function parseCandidateEvent(rawEventJson: string): ArchivedRelayEvent | null {
  try {
    const parsed = JSON.parse(rawEventJson) as Partial<ArchivedRelayEvent>
    if (
      typeof parsed.id !== 'string' ||
      typeof parsed.pubkey !== 'string' ||
      typeof parsed.created_at !== 'number' ||
      typeof parsed.kind !== 'number' ||
      typeof parsed.sig !== 'string'
    ) {
      return null
    }
    return parsed as ArchivedRelayEvent
  } catch {
    return null
  }
}

/** Archives a batch of event candidates. Idempotent — re-archiving a known event id counts as dropped. */
export function archiveEvents(candidates: ArchiveCandidate[]): ArchiveBatchResult {
  const database = getDb()
  const insert = database.prepare(
    `INSERT OR IGNORE INTO archived_events (id, scope_type, scope_value, kind, pubkey, created_at, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )

  let persisted = 0
  let dropped = 0
  for (const candidate of candidates) {
    const event = parseCandidateEvent(candidate.rawEventJson)
    if (!event) {
      dropped += 1
      continue
    }
    const result = insert.run(
      event.id,
      candidate.matchedScope.scopeType,
      candidate.matchedScope.scopeValue,
      event.kind,
      event.pubkey,
      event.created_at,
      candidate.rawEventJson
    )
    if (result.changes > 0) {
      persisted += 1
    } else {
      dropped += 1
    }
  }
  return { persisted, dropped }
}

/** Reads a newest-first page of archived events for a scope, optionally filtered by kind. */
export function readArchivedEvents(
  scopeType: ArchiveScopeType,
  scopeValue: string,
  options: ReadArchivedEventsOptions = {}
): ArchivedRelayEvent[] {
  const database = getDb()
  const limit = Math.min(options.limit ?? DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT)
  const kinds = options.kinds ?? null
  const before = options.before ?? null

  const clauses = ['scope_type = ?', 'scope_value = ?']
  const params: (string | number)[] = [scopeType, scopeValue]

  if (kinds && kinds.length > 0) {
    clauses.push(`kind IN (${kinds.map(() => '?').join(',')})`)
    params.push(...kinds)
  }
  if (before) {
    clauses.push('(created_at < ? OR (created_at = ? AND id < ?))')
    params.push(before.createdAt, before.createdAt, before.id)
  }

  const sql = `
    SELECT raw_json FROM archived_events
    WHERE ${clauses.join(' AND ')}
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `
  const rows = database.prepare(sql).all(...params, limit) as { raw_json: string }[]
  const events: ArchivedRelayEvent[] = []
  for (const row of rows) {
    const parsed = parseCandidateEvent(row.raw_json)
    if (parsed) {
      events.push(parsed)
    }
  }
  return events
}

/** Test/reset hook only — closes and drops the cached database handle. */
export function resetEventArchiveStoreForTests(): void {
  db?.close()
  db = null
}
