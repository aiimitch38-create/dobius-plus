// The library's SQLite file (userData/library.sqlite), through the app's
// node:sqlite adapter. `docs` holds one row per source file or session (kept
// after eviction as a marker, so an evicted file is not re-read every pass),
// `chunks` holds the text once, and `chunks_fts` is an external-content FTS5
// index over the doc title plus the chunk text.
import { statSync } from 'node:fs'
import SyncDatabase from '../sqlite/sync-database'
import { docKeyId, hasFts5, migrateSchema, runTransaction, SCHEMA } from './library-schema'
import type { DocClass } from './library-classify'
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
  kind: DocClass
  compacted?: boolean
}

export const WAL_SIZE_LIMIT = 16 * 1024 * 1024

/** mtime of a document whose write has not finished; never equals a real one. */
const PENDING_MTIME = -1

export class LibraryStore {
  readonly db: SyncDatabase
  readonly fts: boolean

  constructor(readonly path: string) {
    // Why a timeout: the refresh worker writes while main searches.
    this.db = new SyncDatabase(path, { timeout: 5000 })
    // Why before the schema: auto_vacuum only takes effect on an empty file,
    // and lets eviction hand pages back to the disk (it is tight).
    this.db.exec('PRAGMA auto_vacuum = INCREMENTAL')
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA synchronous = NORMAL')
    // Why: a checkpointed WAL is cut back to this size instead of staying at its peak.
    this.db.exec(`PRAGMA journal_size_limit = ${WAL_SIZE_LIMIT}`)
    this.db.exec(SCHEMA)
    migrateSchema(this.db)
    this.fts = hasFts5(this.db)
  }

  close(): void {
    this.db.close()
  }

  getDoc(key: string): StoredDoc | null {
    const row = this.db
      .prepare('SELECT id, key, source, mtime_ms, size, evicted FROM docs WHERE key = ?')
      .get(docKeyId(key)) as
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

  /** Stored key ids (hashes, see docKeyId) of one source. */
  listKeyIds(source: LibrarySource): string[] {
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
    return runTransaction(this.db, work)
  }

  /**
   * Start (re)writing a document: old chunks go, the row is saved with a
   * pending mtime, so a pass cut short (disk full, quit) re-reads it next time.
   */
  beginDoc(doc: DocInput, evicted = false): number {
    return this.transaction(() => {
      const existing = this.getDoc(doc.key)
      if (existing) {
        this.deleteChunks(existing.id)
      }
      this.db
        .prepare(
          `INSERT INTO docs (key, source, project, path, title, mtime_ms, size, evicted, kind, compacted, indexed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET source = excluded.source, project = excluded.project,
             path = excluded.path, title = excluded.title, mtime_ms = excluded.mtime_ms,
             size = excluded.size, evicted = excluded.evicted, kind = excluded.kind,
             compacted = excluded.compacted, indexed_at = excluded.indexed_at`
        )
        .run(
          docKeyId(doc.key), doc.source, doc.project, doc.path, doc.title, PENDING_MTIME, doc.size,
          evicted ? 1 : 0, doc.kind, doc.compacted ? 1 : 0, Date.now()
        )
      return this.getDoc(doc.key)!.id
    })
  }

  /** One small batch of chunks, in its own transaction. */
  addChunks(docId: number, title: string, chunks: LibrarySection[]): void {
    this.transaction(() => {
      const insertChunk = this.db.prepare('INSERT INTO chunks (doc_id, at_ms, text) VALUES (?, ?, ?)')
      const insertFts = this.fts
        ? this.db.prepare('INSERT INTO chunks_fts(rowid, title, text) VALUES (?, ?, ?)')
        : null
      for (const chunk of chunks) {
        const result = insertChunk.run(docId, Math.round(chunk.at), chunk.text)
        insertFts?.run(Number(result.lastInsertRowid), title, chunk.text)
      }
    })
  }

  finishDoc(docId: number, mtimeMs: number): void {
    this.db.prepare('UPDATE docs SET mtime_ms = ? WHERE id = ?').run(Math.round(mtimeMs), docId)
  }

  /** Replace a document's chunks in one go (none = an empty marker row). */
  putDoc(doc: DocInput, chunks: LibrarySection[], evicted = false): number {
    const docId = this.beginDoc(doc, evicted)
    if (chunks.length > 0) {
      this.addChunks(docId, doc.title, chunks)
    }
    this.finishDoc(docId, doc.mtimeMs)
    return docId
  }

  /** Drop a document's text but keep its row, so an unchanged file is not re-read. */
  evictDoc(docId: number): void {
    this.transaction(() => {
      this.deleteChunks(docId)
      this.db.prepare('UPDATE docs SET evicted = 1 WHERE id = ?').run(docId)
    })
  }

  /** Swap a document's chunks for its compact form, in one transaction. */
  replaceWithCompact(docId: number, title: string, text: string): void {
    this.transaction(() => {
      this.deleteChunks(docId)
      this.db.prepare('UPDATE docs SET compacted = 1 WHERE id = ?').run(docId)
      const result = this.db
        .prepare('INSERT INTO chunks (doc_id, at_ms, text) VALUES (?, (SELECT mtime_ms FROM docs WHERE id = ?), ?)')
        .run(docId, docId, text)
      if (this.fts) {
        this.db
          .prepare('INSERT INTO chunks_fts(rowid, title, text) VALUES (?, ?, ?)')
          .run(Number(result.lastInsertRowid), title, text)
      }
    })
  }

  removeDocByKeyId(keyId: string): void {
    const row = this.db.prepare('SELECT id FROM docs WHERE key = ?').get(keyId) as
      | { id: number }
      | undefined
    if (!row) {
      return
    }
    this.transaction(() => {
      this.deleteChunks(row.id)
      this.db.prepare('DELETE FROM docs WHERE id = ?').run(row.id)
    })
  }

  walBytes(): number {
    try {
      return statSync(`${this.path}-wal`).size
    } catch {
      return 0
    }
  }

  /** Bytes in used pages of the main file (free pages are reused by new rows). */
  pageBytes(): number {
    const pageSize = Number(this.db.pragma('page_size', { simple: true }))
    const pages = Number(this.db.pragma('page_count', { simple: true }))
    const free = Number(this.db.pragma('freelist_count', { simple: true }))
    return (pages - free) * pageSize
  }

  /** Bytes counted against the cap: used pages plus the WAL. */
  usedBytes(): number {
    return this.pageBytes() + this.walBytes()
  }

  fileBytes(): number {
    const pageSize = Number(this.db.pragma('page_size', { simple: true }))
    return Number(this.db.pragma('page_count', { simple: true })) * pageSize + this.walBytes()
  }

  /**
   * Merge FTS segments a little. Why: each eviction leaves delete markers that
   * every search must step over until segments merge; searches on main slowed
   * to ~100 ms during eviction without this.
   */
  mergeIndex(pages = 500): void {
    if (this.fts) {
      this.db.prepare("INSERT INTO chunks_fts(chunks_fts, rank) VALUES('merge', ?)").run(pages)
    }
  }

  /** Copy WAL frames into the main file without waiting on readers, so the WAL can restart small. */
  checkpointPassive(): void {
    this.db.exec('PRAGMA wal_checkpoint(PASSIVE)')
  }

  /** Fold the WAL into the main file and cut it back to zero. */
  checkpoint(): void {
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  }

  /**
   * Give freed pages back to the disk. Why a passive checkpoint: TRUNCATE
   * made main's searches wait (up to ~150 ms) on the worker; with
   * journal_size_limit the WAL is cut back to 16 MB when it restarts anyway.
   */
  compact(): void {
    this.db.exec('PRAGMA incremental_vacuum')
    this.checkpointPassive()
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
