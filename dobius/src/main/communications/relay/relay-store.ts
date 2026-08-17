/**
 * Durable event store for the local Dobius relay.
 *
 * Mirrors `src/main/runtime/orchestration/db.ts`: same `SyncDatabase` wrapper
 * (node:sqlite, not better-sqlite3), same pragmas, same schema-version guard.
 */
import Database from '../../sqlite/sync-database'
import {
  RELAY_DEFAULT_QUERY_LIMIT,
  RELAY_MAX_QUERY_LIMIT,
  RELAY_TAG_FILTER_KEYS,
  isAddressableKind,
  isReplaceableKind,
  type RelayEvent,
  type RelayFilter
} from './relay-types'

const SCHEMA_VERSION = 1

/** Outcome of `RelayStore.insert`, shaped for `RelaySubmissionResponse`. */
export type RelayInsertResult = {
  accepted: boolean
  message?: string
}

type EventRow = {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string
  content: string
  sig: string
}

type ReplacementCandidate = {
  id: string
  created_at: number
}

/** The `d` tag value used to key addressable-kind replacement (`''` when absent). */
function extractDTag(tags: string[][]): string {
  return tags.find((tag) => tag[0] === 'd')?.[1] ?? ''
}

/**
 * NIP-01 replacement ordering: newer `created_at` wins, and an exact tie is
 * broken by the lexically lower id so every replica keeps the same survivor.
 */
function supersedes(incoming: RelayEvent, stored: ReplacementCandidate): boolean {
  if (incoming.created_at !== stored.created_at) {
    return incoming.created_at > stored.created_at
  }
  return incoming.id < stored.id
}

/** Newest-first, id ascending — the order the Buzz clients render feeds in. */
function compareNewestFirst(a: RelayEvent, b: RelayEvent): number {
  if (a.created_at !== b.created_at) {
    return b.created_at - a.created_at
  }
  if (a.id === b.id) {
    return 0
  }
  return a.id < b.id ? -1 : 1
}

/**
 * Why loud instead of lenient: this store holds the user's real message
 * history, so a row we cannot read back faithfully is corruption and must
 * surface, not silently degrade into an event with no tags.
 */
function parseStoredTags(eventId: string, raw: string): string[][] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`Relay store: event ${eventId} has unparseable tags JSON`)
  }
  const valid =
    Array.isArray(parsed) &&
    parsed.every((tag) => Array.isArray(tag) && tag.every((part) => typeof part === 'string'))
  if (!valid) {
    throw new Error(`Relay store: event ${eventId} has malformed tags`)
  }
  return parsed as string[][]
}

function toRelayEvent(row: EventRow): RelayEvent {
  return {
    id: row.id,
    pubkey: row.pubkey,
    created_at: row.created_at,
    kind: row.kind,
    tags: parseStoredTags(row.id, row.tags),
    content: row.content,
    sig: row.sig
  }
}

/** Builds `?,?,?` from a count — a number we computed, never caller text. */
function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(',')
}

function clampLimit(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return RELAY_DEFAULT_QUERY_LIMIT
  }
  return Math.max(0, Math.min(Math.floor(requested), RELAY_MAX_QUERY_LIMIT))
}

type BuiltQuery = {
  sql: string
  params: Database.BindValue[]
}

export class RelayStore {
  private db: Database.Database

  constructor(dbPath: string | ':memory:') {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.pragma('busy_timeout = 5000')
    this.createTables()
    this.db.pragma(`user_version = ${SCHEMA_VERSION}`)
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id          TEXT PRIMARY KEY,
        pubkey      TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        kind        INTEGER NOT NULL,
        tags        TEXT NOT NULL,
        content     TEXT NOT NULL,
        sig         TEXT NOT NULL,
        d_tag       TEXT NOT NULL DEFAULT ''
      );

      CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC, id ASC);
      CREATE INDEX IF NOT EXISTS idx_events_kind_created ON events(kind, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_events_author_created ON events(pubkey, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_events_replacement ON events(pubkey, kind, d_tag);

      CREATE TABLE IF NOT EXISTS event_tags (
        event_id  TEXT NOT NULL,
        name      TEXT NOT NULL,
        value     TEXT NOT NULL,
        PRIMARY KEY (event_id, name, value)
      ) WITHOUT ROWID;

      CREATE INDEX IF NOT EXISTS idx_event_tags_lookup ON event_tags(name, value);
    `)
  }

  /**
   * Persists an event, collapsing replaceable/addressable kinds to the newest.
   *
   * A duplicate id is success, not an error — clients resend on reconnect.
   */
  insert(event: RelayEvent): RelayInsertResult {
    // Why IMMEDIATE: it takes the write lock at BEGIN, before the supersede
    // read, so two concurrent writers cannot both see a stale "current" row
    // and both conclude they are the newest.
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = this.insertWithinTransaction(event)
      this.db.exec('COMMIT')
      return result
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  private insertWithinTransaction(event: RelayEvent): RelayInsertResult {
    const existing = this.db.prepare('SELECT id FROM events WHERE id = ?').get(event.id)
    if (existing) {
      return { accepted: true, message: 'duplicate: event already stored' }
    }

    const superseded = this.collapseReplaced(event)
    if (superseded) {
      return superseded
    }

    this.db
      .prepare(
        `INSERT INTO events (id, pubkey, created_at, kind, tags, content, sig, d_tag)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.id,
        event.pubkey,
        event.created_at,
        event.kind,
        JSON.stringify(event.tags),
        event.content,
        event.sig,
        extractDTag(event.tags)
      )
    this.indexTags(event)
    return { accepted: true }
  }

  /**
   * Deletes the events this one replaces, or reports that it lost the race.
   * Returns a result only when the incoming event must NOT be stored.
   */
  private collapseReplaced(event: RelayEvent): RelayInsertResult | undefined {
    const current = this.findReplacementCandidates(event)
    if (current.length === 0) {
      return undefined
    }
    if (current.some((stored) => !supersedes(event, stored))) {
      return { accepted: true, message: 'superseded by a newer stored event of the same kind' }
    }
    const deleteTags = this.db.prepare('DELETE FROM event_tags WHERE event_id = ?')
    const deleteEvent = this.db.prepare('DELETE FROM events WHERE id = ?')
    for (const stored of current) {
      deleteTags.run(stored.id)
      deleteEvent.run(stored.id)
    }
    return undefined
  }

  /**
   * Replaceable kinds key on (pubkey, kind); addressable kinds add the d tag.
   * Returns a list rather than one row so a store that somehow holds more than
   * one row per key still collapses fully instead of leaking a revision.
   */
  private findReplacementCandidates(event: RelayEvent): ReplacementCandidate[] {
    if (isAddressableKind(event.kind)) {
      return this.db
        .prepare('SELECT id, created_at FROM events WHERE pubkey = ? AND kind = ? AND d_tag = ?')
        .all(event.pubkey, event.kind, extractDTag(event.tags)) as ReplacementCandidate[]
    }
    if (isReplaceableKind(event.kind)) {
      return this.db
        .prepare('SELECT id, created_at FROM events WHERE pubkey = ? AND kind = ?')
        .all(event.pubkey, event.kind) as ReplacementCandidate[]
    }
    return []
  }

  /**
   * Indexes single-letter tag names only — NIP-01 says those are the
   * queryable ones, and it keeps `#d`/`#p`/`#h`/`#e` lookups off a full scan.
   * OR IGNORE because an event may legitimately repeat the same tag twice.
   */
  private indexTags(event: RelayEvent): void {
    const stmt = this.db.prepare(
      'INSERT OR IGNORE INTO event_tags (event_id, name, value) VALUES (?, ?, ?)'
    )
    for (const tag of event.tags) {
      const name = tag[0]
      if (typeof name !== 'string' || name.length !== 1) {
        continue
      }
      stmt.run(event.id, name, tag[1] ?? '')
    }
  }

  /**
   * Runs each filter independently (each honours its own `limit`), then merges
   * and dedupes by id — NIP-01 `limit` semantics are per filter, not per query.
   */
  query(filters: RelayFilter[]): RelayEvent[] {
    const byId = new Map<string, RelayEvent>()
    for (const filter of filters) {
      const built = this.buildFilterQuery(filter)
      if (!built) {
        continue
      }
      const rows = this.db.prepare(built.sql).all(...built.params) as EventRow[]
      for (const row of rows) {
        if (!byId.has(row.id)) {
          byId.set(row.id, toRelayEvent(row))
        }
      }
    }
    return [...byId.values()].sort(compareNewestFirst)
  }

  /**
   * Returns undefined when the filter cannot match anything (an empty `ids` /
   * `authors` / `kinds` / tag array, or `limit: 0`), so we skip the round trip.
   */
  private buildFilterQuery(filter: RelayFilter): BuiltQuery | undefined {
    const clauses: string[] = []
    const params: Database.BindValue[] = []

    if (filter.ids) {
      if (filter.ids.length === 0) {
        return undefined
      }
      clauses.push(`id IN (${placeholders(filter.ids.length)})`)
      params.push(...filter.ids)
    }
    if (filter.authors) {
      if (filter.authors.length === 0) {
        return undefined
      }
      clauses.push(`pubkey IN (${placeholders(filter.authors.length)})`)
      params.push(...filter.authors)
    }
    if (filter.kinds) {
      if (filter.kinds.length === 0) {
        return undefined
      }
      clauses.push(`kind IN (${placeholders(filter.kinds.length)})`)
      params.push(...filter.kinds)
    }
    if (filter.since !== undefined) {
      clauses.push('created_at >= ?')
      params.push(filter.since)
    }
    for (const key of RELAY_TAG_FILTER_KEYS) {
      const values = filter[key]
      if (!values) {
        continue
      }
      if (values.length === 0) {
        return undefined
      }
      clauses.push(
        `EXISTS (SELECT 1 FROM event_tags WHERE event_tags.event_id = events.id
           AND event_tags.name = ? AND event_tags.value IN (${placeholders(values.length)}))`
      )
      params.push(key.slice(1), ...values)
    }

    const limit = clampLimit(filter.limit)
    if (limit === 0) {
      return undefined
    }
    params.push(limit)

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    return {
      sql: `SELECT id, pubkey, created_at, kind, tags, content, sig
            FROM events ${where}
            ORDER BY created_at DESC, id ASC
            LIMIT ?`,
      params
    }
  }

  close(): void {
    this.db.close()
  }
}
