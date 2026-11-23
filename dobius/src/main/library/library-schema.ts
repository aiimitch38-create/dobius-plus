// The library's tables, their version, and the helpers that keep secrets out
// of keys and errors visible through rollbacks.
import { createHash } from 'node:crypto'
import type SyncDatabase from '../sqlite/sync-database'

/**
 * 2: docs.key holds a sha256 of the source key, not the raw path. Why a
 * rebuild rather than a migration: the old keys are exactly what must go, and
 * the next pass re-reads everything.
 */
export const SCHEMA_VERSION = 2

/** The stored identity of a source key. Why a hash: the key carries the raw path. */
export function docKeyId(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS docs (
    id INTEGER PRIMARY KEY,
    -- sha256 of the source key (which holds the raw path), never the path itself
    key TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL,
    project TEXT,
    path TEXT NOT NULL,
    title TEXT NOT NULL,
    mtime_ms INTEGER NOT NULL,
    size INTEGER NOT NULL,
    evicted INTEGER NOT NULL DEFAULT 0,
    indexed_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS docs_live_mtime ON docs(evicted, mtime_ms);
  CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY,
    doc_id INTEGER NOT NULL,
    at_ms INTEGER NOT NULL,
    text TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS chunks_doc ON chunks(doc_id);
  CREATE VIEW IF NOT EXISTS chunk_view AS
    SELECT c.id AS id, d.title AS title, c.text AS text
    FROM chunks c JOIN docs d ON d.id = c.doc_id;
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`

const FTS_SCHEMA = `
  CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    title, text, content='chunk_view', content_rowid='id', tokenize='porter unicode61'
  );
`

export function hasFts5(db: SyncDatabase): boolean {
  try {
    db.exec(FTS_SCHEMA)
    return true
  } catch (error) {
    console.warn('Library: FTS5 is unavailable, search falls back to LIKE:', error)
    return false
  }
}


/** Drop the tables of an older layout so they are rebuilt empty. */
export function migrateSchema(db: SyncDatabase): void {
  const version = Number(db.pragma('user_version', { simple: true }))
  if (version >= SCHEMA_VERSION) {
    return
  }
  db.exec(`
    DROP TABLE IF EXISTS chunks_fts;
    DROP VIEW IF EXISTS chunk_view;
    DROP TABLE IF EXISTS chunks;
    DROP TABLE IF EXISTS docs;
  `)
  db.exec(SCHEMA)
  db.exec(`DELETE FROM meta WHERE key = 'lastRefresh'`)
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
}

function isNoTransaction(error: unknown): boolean {
  return /no transaction is active|cannot rollback - no transaction/i.test(
    error instanceof Error ? error.message : String(error)
  )
}

/**
 * Run work in one IMMEDIATE transaction. Why the guarded rollback: SQLite
 * rolls back by itself on SQLITE_FULL, and a second ROLLBACK then throws "no
 * transaction is active", which used to replace the disk-full error and let
 * the pass carry on. The original error is always what is thrown.
 */
export function runTransaction<T>(db: SyncDatabase, work: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = work()
    db.exec('COMMIT')
    return result
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch (rollbackError) {
      if (!isNoTransaction(rollbackError)) {
        console.warn('Library: rollback failed after', error, rollbackError)
      }
    }
    throw error
  }
}
