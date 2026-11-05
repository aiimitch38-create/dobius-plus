import { createHash, randomUUID } from 'node:crypto'
import type { AdamDatabase } from '../db/database.js'
import type { IMessageSource, IMessageSourceRecord } from './source.js'

export type IngestionResult = {
  sourceId: string
  scanned: number
  inserted: number
  duplicates: number
  rejected: number
  lastRowid: number
  complete: boolean
  digest: string
}

export class IMessageIngester {
  constructor(private readonly db: AdamDatabase, private readonly source: IMessageSource, private readonly sourceId = 'carson-adam-thread') {}

  cursor(): number {
    const row = this.db.prepare('SELECT last_rowid FROM imessage_ingestion_cursors WHERE source_id = ?').get(this.sourceId)
    return Number(row?.last_rowid ?? 0)
  }

  ingestPage(limit = 250): IngestionResult {
    const start = this.cursor()
    const records = this.source.readAfter(start, limit)
    let inserted = 0
    let duplicates = 0
    let rejected = 0
    let lastRowid = start
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const record of records) {
        lastRowid = Math.max(lastRowid, record.rowid)
        if (!record.appleGuid || !record.chatGuid) { rejected++; continue }
        const result = this.insertRecord(record)
        if (result) inserted++; else duplicates++
        if (record.decodeError && !record.attachments.length) rejected++
      }
      const now = new Date().toISOString()
      const last = records.at(-1)
      const digest = createHash('sha256').update(records.map((record) => `${record.rowid}:${record.rawDigest}`).join('|')).digest('hex')
      this.db.prepare(`
        INSERT INTO imessage_ingestion_cursors
          (source_id, last_rowid, last_guid, last_message_at, source_digest, state, error, updated_at)
        VALUES (?, ?, ?, ?, ?, 'healthy', NULL, ?)
        ON CONFLICT(source_id) DO UPDATE SET
          last_rowid=excluded.last_rowid, last_guid=excluded.last_guid,
          last_message_at=excluded.last_message_at, source_digest=excluded.source_digest,
          state='healthy', error=NULL, updated_at=excluded.updated_at
      `).run(this.sourceId, lastRowid, last?.appleGuid ?? null, last?.sentAt ?? null, digest, now)
      this.db.exec('COMMIT')
      return { sourceId: this.sourceId, scanned: records.length, inserted, duplicates, rejected,
        lastRowid, complete: records.length < limit, digest }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  backfill(pageSize = 250, maxPages = 10_000): IngestionResult {
    let aggregate: IngestionResult = { sourceId: this.sourceId, scanned: 0, inserted: 0, duplicates: 0, rejected: 0, lastRowid: this.cursor(), complete: false, digest: '' }
    for (let page = 0; page < maxPages; page++) {
      const result = this.ingestPage(pageSize)
      aggregate = {
        ...result, scanned: aggregate.scanned + result.scanned, inserted: aggregate.inserted + result.inserted,
        duplicates: aggregate.duplicates + result.duplicates, rejected: aggregate.rejected + result.rejected
      }
      if (result.complete) return aggregate
    }
    return aggregate
  }

  private insertRecord(record: IMessageSourceRecord): boolean {
    const now = new Date().toISOString()
    const threadId = `imessage-thread:${createHash('sha256').update(record.chatGuid).digest('hex').slice(0, 32)}`
    this.db.prepare(`
      INSERT INTO imessage_threads
        (id, chat_guid, chat_identifier, display_name, scope, latest_message_rowid, latest_message_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'adam_self', ?, ?, ?, ?)
      ON CONFLICT(chat_guid) DO UPDATE SET
        chat_identifier=excluded.chat_identifier, display_name=excluded.display_name,
        latest_message_rowid=MAX(COALESCE(imessage_threads.latest_message_rowid, 0), excluded.latest_message_rowid),
        latest_message_at=CASE WHEN excluded.latest_message_rowid >= COALESCE(imessage_threads.latest_message_rowid, 0)
          THEN excluded.latest_message_at ELSE imessage_threads.latest_message_at END,
        updated_at=excluded.updated_at
    `).run(threadId, record.chatGuid, record.chatIdentifier, record.displayName, record.rowid, record.sentAt, now, now)

    const messageId = `imessage:${record.appleGuid}`
    const existed = this.db.prepare('SELECT 1 AS present FROM imessage_messages WHERE apple_guid=?').get(record.appleGuid) !== undefined
    const result = this.db.prepare(`
      INSERT INTO imessage_messages
        (id, apple_guid, rowid, thread_id, sender_identity, direction, text, text_source,
         message_kind, reply_to_guid, associated_message_guid, sent_at, raw_digest, ingested_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(apple_guid) DO UPDATE SET
        rowid=excluded.rowid, thread_id=excluded.thread_id, sender_identity=excluded.sender_identity,
        direction=excluded.direction, text=excluded.text, text_source=excluded.text_source,
        message_kind=excluded.message_kind, reply_to_guid=excluded.reply_to_guid,
        associated_message_guid=excluded.associated_message_guid, sent_at=excluded.sent_at,
        raw_digest=excluded.raw_digest, ingested_at=excluded.ingested_at
    `).run(messageId, record.appleGuid, record.rowid, threadId, record.senderIdentity, record.direction,
      record.text, record.textSource, record.messageKind, record.replyToGuid, record.associatedMessageGuid,
      record.sentAt, record.rawDigest, now)
    const wasInserted = !existed && Number(result.changes) > 0
    for (const attachment of record.attachments) {
      this.db.prepare(`
        INSERT INTO imessage_attachments
          (id, message_id, apple_attachment_guid, filename, mime_type, uti, size_bytes,
           local_path, derivation_state, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
        ON CONFLICT(apple_attachment_guid) DO NOTHING
      `).run(randomUUID(), messageId, attachment.guid, attachment.filename, attachment.mimeType,
        attachment.uti, attachment.sizeBytes, attachment.filename, now, now)
    }
    return wasInserted
  }
}
