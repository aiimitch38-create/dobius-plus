// The library's SQLite file (userData/library.sqlite), through the app's
// node:sqlite adapter. `docs` holds one row per source file or session (kept
// after eviction as a marker, so an evicted file is not re-read every pass),
// `chunks` holds the text once, and `chunks_fts` is an external-content FTS5
// index over the doc title plus the chunk text.
import SyncDatabase from '../sqlite/sync-database'
import type { LibrarySection, LibrarySource } from './library-types'

export type StoredDoc = {
  id: number
  key: string
  source: LibrarySource
  mtimeMs: number
  size: number
  evicted: boolean
}

export type DocInput = {
  key: string
  source: LibrarySource
  project: string | null
  path: string
  title: string
  mtimeMs: number
  size: number
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS docs (
    id INTEGER PRIMARY KEY,
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

function hasFts5(db: SyncDatabase): boolean {
  try {
    db.exec(FTS_SCHEMA)
    return true
  } catch (error) {
    console.warn('Library: FTS5 is unavailable, search falls back to LIKE:', error)
    return false
  }
}

export class LibraryStore {
  readonly db: SyncDatabase
  readonly fts: boolean

  constructor(path: string) {
    this.db = new SyncDatabase(path)
    // Why before the schema: auto_vacuum only takes effect on an empty file,
    // and lets eviction hand pages back to the disk (it is tight).
    this.db.exec('PRAGMA auto_vacuum = INCREMENTAL')
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA synchronous = NORMAL')
    this.db.exec(SCHEMA)
    this.fts = hasFts5(this.db)
  }

  close(): void {
    this.db.close()
  }

  getDoc(key: string): StoredDoc | null {
    const row = this.db
      .prepare('SELECT id, key, source, mtime_ms, size, evicted FROM docs WHERE key = ?')
      .get(key) as
      | { id: number; key: string; source: LibrarySource; mtime_ms: number; size: number; evicted: number }
      | undefined
    return row
      ? {
          id: row.id,
          key: row.key,
          source: row.source,
          mtimeMs: row.mtime_ms,
          size: row.size,
          evicted: row.evicted === 1
        }
      : null
  }

  listKeys(source: LibrarySource): string[] {
    return (
      this.db.prepare('SELECT key FROM docs WHERE source = ?').all(source) as { key: string }[]
    ).map((row) => row.key)
  }

  private deleteChunks(docId: number): void {
    if (this.fts) {
      // Why: an external-content index needs the old values to remove a row.
      this.db
        .prepare(
          `INSERT INTO chunks_fts(chunks_fts, rowid, title, text)
           SELECT 'delete', c.id, d.title, c.text FROM chunks c JOIN docs d ON d.id = c.doc_id
           WHERE c.doc_id = ?`
        )
        .run(docId)
    }
    this.db.prepare('DELETE FROM chunks WHERE doc_id = ?').run(docId)
  }

  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /** Replace a document's chunks (none = an empty marker row). */
  putDoc(doc: DocInput, chunks: LibrarySection[], evicted = false): number {
    return this.transaction(() => {
      const existing = this.getDoc(doc.key)
      if (existing) {
        this.deleteChunks(existing.id)
      }
      this.db
        .prepare(
          `INSERT INTO docs (key, source, project, path, title, mtime_ms, size, evicted, indexed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET source = excluded.source, project = excluded.project,
             path = excluded.path, title = excluded.title, mtime_ms = excluded.mtime_ms,
             size = excluded.size, evicted = excluded.evicted, indexed_at = excluded.indexed_at`
        )
        .run(
          doc.key,
          doc.source,
          doc.project,
          doc.path,
          doc.title,
          Math.round(doc.mtimeMs),
          doc.size,
          evicted ? 1 : 0,
          Date.now()
        )
      const docId = this.getDoc(doc.key)!.id
      const insertChunk = this.db.prepare('INSERT INTO chunks (doc_id, at_ms, text) VALUES (?, ?, ?)')
      const insertFts = this.fts
        ? this.db.prepare('INSERT INTO chunks_fts(rowid, title, text) VALUES (?, ?, ?)')
        : null
      for (const chunk of chunks) {
        const result = insertChunk.run(docId, Math.round(chunk.at), chunk.text)
        insertFts?.run(Number(result.lastInsertRowid), doc.title, chunk.text)
      }
      return docId
    })
  }

  /** Drop a document's text but keep its row, so an unchanged file is not re-read. */
  evictDoc(docId: number): void {
    this.transaction(() => {
      this.deleteChunks(docId)
      this.db.prepare('UPDATE docs SET evicted = 1 WHERE id = ?').run(docId)
    })
  }

  removeDoc(key: string): void {
    const doc = this.getDoc(key)
    if (!doc) {
      return
    }
    this.transaction(() => {
      this.deleteChunks(doc.id)
      this.db.prepare('DELETE FROM docs WHERE id = ?').run(doc.id)
    })
  }

  /** The oldest document that still has text. */
  oldestLiveDoc(): { id: number; mtimeMs: number } | null {
    const row = this.db
      .prepare('SELECT id, mtime_ms FROM docs WHERE evicted = 0 ORDER BY mtime_ms ASC LIMIT 1')
      .get() as { id: number; mtime_ms: number } | undefined
    return row ? { id: row.id, mtimeMs: row.mtime_ms } : null
  }

  /** Bytes in use (free pages excluded, since new rows reuse them). */
  usedBytes(): number {
    const pageSize = Number(this.db.pragma('page_size', { simple: true }))
    const pages = Number(this.db.pragma('page_count', { simple: true }))
    const free = Number(this.db.pragma('freelist_count', { simple: true }))
    return (pages - free) * pageSize
  }

  fileBytes(): number {
    const pageSize = Number(this.db.pragma('page_size', { simple: true }))
    return Number(this.db.pragma('page_count', { simple: true })) * pageSize
  }

  /** Give freed pages back to the disk. */
  compact(): void {
    this.db.exec('PRAGMA incremental_vacuum')
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value ?? null
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      )
      .run(key, value)
  }
}
