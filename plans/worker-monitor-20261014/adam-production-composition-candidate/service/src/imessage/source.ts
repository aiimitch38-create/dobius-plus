import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { decodeMessageBody } from './decoder.js'

export type IMessageAttachmentRecord = {
  guid: string
  filename: string | null
  mimeType: string | null
  uti: string | null
  sizeBytes: number | null
}

export type IMessageSourceRecord = {
  rowid: number
  appleGuid: string
  chatGuid: string
  chatIdentifier: string
  displayName: string | null
  senderIdentity: string | null
  direction: 'inbound' | 'outbound' | 'external'
  text: string | null
  textSource: 'text' | 'attributedBody' | null
  decodeError?: string
  messageKind: 'text' | 'image' | 'audio' | 'file' | 'reaction' | 'edit' | 'system'
  associatedMessageGuid: string | null
  replyToGuid: string | null
  sentAt: string
  rawDigest: string
  attachments: IMessageAttachmentRecord[]
}

export type IMessageSource = {
  readAfter(rowid: number, limit: number): IMessageSourceRecord[]
  maxAuthorizedRowid(): number
  close(): void
}

function appleDateToIso(rawValue: string): string {
  const value = BigInt(rawValue || '0')
  const millisecondsSinceAppleEpoch = value > 10_000_000_000n ? value / 1_000_000n : value * 1_000n
  const milliseconds = Number(millisecondsSinceAppleEpoch)
  return new Date(Date.UTC(2001, 0, 1) + milliseconds).toISOString()
}

function kindFor(associatedType: number, attachments: IMessageAttachmentRecord[]): IMessageSourceRecord['messageKind'] {
  if (associatedType > 0) return associatedType === 2000 ? 'reaction' : 'edit'
  if (!attachments.length) return 'text'
  if (attachments.some((item) => item.mimeType?.startsWith('image/'))) return 'image'
  if (attachments.some((item) => item.mimeType?.startsWith('audio/'))) return 'audio'
  return 'file'
}

export class ChatDatabaseSource implements IMessageSource {
  private readonly db: DatabaseSync

  constructor(path: string, private readonly allowedChatIdentifiers: readonly string[]) {
    if (!allowedChatIdentifiers.length) throw new Error('at least one exact authorized iMessage chat identifier is required')
    this.db = new DatabaseSync(path, { readOnly: true })
    this.db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;')
  }

  readAfter(rowid: number, limit: number): IMessageSourceRecord[] {
    const placeholders = this.allowedChatIdentifiers.map(() => '?').join(',')
    const rows = this.db.prepare(`
      SELECT m.ROWID AS rowid, m.guid AS apple_guid, m.text, m.attributedBody,
             m.is_from_me, COALESCE(m.destination_caller_id, '') AS destination,
             CAST(m.date AS TEXT) AS apple_date, COALESCE(m.associated_message_type, 0) AS associated_type,
             m.associated_message_guid, m.thread_originator_guid,
             c.guid AS chat_guid, c.chat_identifier, c.display_name,
             h.id AS sender_identity
      FROM message m
      JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
      JOIN chat c ON c.ROWID = cmj.chat_id
      LEFT JOIN handle h ON h.ROWID = m.handle_id
      WHERE m.ROWID > ? AND COALESCE(m.service, '') = 'iMessage'
        AND c.chat_identifier IN (${placeholders})
      ORDER BY m.ROWID
      LIMIT ?
    `).all(rowid, ...this.allowedChatIdentifiers, limit) as Record<string, unknown>[]

    const attachmentQuery = this.db.prepare(`
      SELECT COALESCE(a.guid, 'legacy-' || a.ROWID) AS guid, a.filename,
             a.mime_type, a.uti, a.total_bytes
      FROM attachment a
      JOIN message_attachment_join maj ON maj.attachment_id = a.ROWID
      WHERE maj.message_id = ?
      ORDER BY a.ROWID
    `)
    return rows.map((row) => {
      const attachments = (attachmentQuery.all(Number(row.rowid)) as Record<string, unknown>[]).map((item) => ({
        guid: String(item.guid), filename: item.filename === null ? null : String(item.filename),
        mimeType: item.mime_type === null ? null : String(item.mime_type),
        uti: item.uti === null ? null : String(item.uti),
        sizeBytes: item.total_bytes === null ? null : Number(item.total_bytes)
      }))
      const body = decodeMessageBody(
        row.text === null ? null : String(row.text),
        row.attributedBody instanceof Uint8Array ? row.attributedBody : null
      )
      // Same-Apple-ID thread: Mac/ADAM sends are is_from_me=1 to Carson's email;
      // phone-originated messages are either is_from_me=0 or target the phone.
      const direction = Number(row.is_from_me) === 1 && String(row.destination) !== '+17344784716'
        ? 'outbound'
        : 'inbound'
      const digest = createHash('sha256').update(JSON.stringify({
        guid: row.apple_guid, text: body.text, date: row.apple_date,
        associated: row.associated_message_guid, attachments: attachments.map((item) => item.guid)
      })).digest('hex')
      return {
        rowid: Number(row.rowid), appleGuid: String(row.apple_guid || `legacy-${row.rowid}`),
        chatGuid: String(row.chat_guid), chatIdentifier: String(row.chat_identifier),
        displayName: row.display_name === null ? null : String(row.display_name),
        senderIdentity: row.sender_identity === null ? null : String(row.sender_identity),
        direction, text: body.text, textSource: body.source,
        ...(body.error ? { decodeError: body.error } : {}),
        messageKind: kindFor(Number(row.associated_type), attachments),
        associatedMessageGuid: row.associated_message_guid === null ? null : String(row.associated_message_guid).replace(/^p:\d+\//, ''),
        replyToGuid: row.thread_originator_guid === null ? null : String(row.thread_originator_guid),
        sentAt: appleDateToIso(String(row.apple_date)), rawDigest: digest, attachments
      }
    })
  }

  maxAuthorizedRowid(): number {
    const placeholders = this.allowedChatIdentifiers.map(() => '?').join(',')
    const row = this.db.prepare(`
      SELECT COALESCE(MAX(m.ROWID), 0) AS rowid FROM message m
      JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
      JOIN chat c ON c.ROWID = cmj.chat_id
      WHERE c.chat_identifier IN (${placeholders})
    `).get(...this.allowedChatIdentifiers)
    return Number(row?.rowid ?? 0)
  }

  close(): void { this.db.close() }
}
