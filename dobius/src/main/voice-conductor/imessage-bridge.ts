import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import SyncDatabase from '../sqlite/sync-database'
import { extractChatDbMessageText } from '../imessage-bridge/chat-db-message-text'
import { isValidImessageHandle, sendImessage } from '../imessage-bridge/imessage-send'
import { selfHandleSpellings } from '../imessage-bridge/self-handle-spellings'
import type { IMessageBridge } from './types'

// Voice Conductor iMessage bridge (macOS only). Lets the background conductor
// session text Carson to ask a blocking question or send a "work done" report.
//
// Reuses the app's existing primitives instead of re-implementing them:
//   - sendImessage()             → osascript send + outbound rate limit
//   - extractChatDbMessageText() → decode plain/attributedBody message text
//   - selfHandleSpellings()      → exact chat.db spellings of the handle
//   - SyncDatabase               → node:sqlite reader for chat.db
//
// Permissions required (one-time, macOS System Settings → Privacy & Security):
//   - Automation → Messages.app  (osascript send)
//   - Full Disk Access           (read ~/Library/Messages/chat.db for replies)

const DEFAULT_CHAT_DB_PATH = path.join(os.homedir(), 'Library', 'Messages', 'chat.db')
const DEFAULT_POLL_INTERVAL_MS = 2_000
const DEFAULT_ASK_TIMEOUT_MS = 5 * 60 * 1000
// Codes are never reused within a session until this many have been issued,
// so a late reply to an expired question can't answer a newer one.
const MAX_REMEMBERED_CODES = 5_000
const MAX_REMEMBERED_OUTBOUND = 200

export const IMESSAGE_HANDLE_MISSING =
  'iMessage handle not configured: set your handle in Settings → iMessage bridge'
export const IMESSAGE_HANDLE_INVALID =
  'iMessage handle in Settings → iMessage bridge is not a phone number or email'

/**
 * Config for {@link createIMessageBridge}. The recipient handle and any machine
 * path come from here — nothing is hardcoded.
 */
export type VoiceConductorImessageConfig = {
  /**
   * Carson's iMessage handle (email or phone), read at each use so a Settings
   * change applies without restarting the conductor. Null/empty = not set.
   */
  resolveHandle: () => string | null
  /** Override the chat.db path (default: ~/Library/Messages/chat.db). */
  chatDbPath?: string
  /** How often ask() re-scans chat.db for a reply (default 2000ms). */
  pollIntervalMs?: number
  /**
   * Platform to gate on. Defaults to process.platform; injectable so the gate
   * can be unit-tested without a real macOS host.
   */
  platform?: NodeJS.Platform
}

// Reply lookup: rows newer than the baseline ROWID in the EXACT 1:1 chat with
// the handle (selfHandleSpellings; never LIKE, never a group chat), sent either
// by the handle itself or from this Apple ID (is_from_me, for the self-thread
// case). Rows with no chat link fall back to an exact handle match. The caller
// then accepts only a row that starts with this question's reply code.
const NEW_REPLY_SQL = `
  SELECT message.ROWID AS rowid,
         message.text AS text,
         message.attributedBody AS attributedBody
  FROM message
  LEFT JOIN handle ON message.handle_id = handle.ROWID
  LEFT JOIN chat_message_join ON message.ROWID = chat_message_join.message_id
  LEFT JOIN chat ON chat_message_join.chat_id = chat.ROWID
  WHERE message.ROWID > ?
    AND (
      (chat.ROWID IS NOT NULL
        AND lower(chat.chat_identifier) IN (SELECT value FROM json_each(?))
        AND instr(chat.guid, ';+;') = 0
        AND (message.is_from_me = 1 OR lower(handle.id) IN (SELECT value FROM json_each(?))))
      OR (chat.ROWID IS NULL AND lower(handle.id) IN (SELECT value FROM json_each(?)))
    )
  GROUP BY message.ROWID
  ORDER BY message.ROWID ASC
  LIMIT 50
`

// "<code> <answer>": the code must be the first token, exactly four digits.
const CODED_REPLY_RE = /^\s*(\d{4})(?!\d)[\s:.,)-]*([\s\S]*)$/

type ReplyRow = {
  rowid: number
  text: string | null
  attributedBody: Uint8Array | null
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function maxRowid(db: SyncDatabase.Database): number {
  const row = db.prepare('SELECT COALESCE(MAX(ROWID), 0) AS maxRowid FROM message').get() as {
    maxRowid: number
  }
  return row.maxRowid
}

/** The answer text when `text` is a reply to `code`, else null. */
export function parseCodedReply(text: string, code: string): string | null {
  const match = CODED_REPLY_RE.exec(text)
  if (!match || match[1] !== code) {
    return null
  }
  const answer = match[2].trim()
  return answer.length > 0 ? answer : null
}

/**
 * Create the Voice Conductor's iMessage bridge.
 *
 * - `unavailableReason()` — null when usable; otherwise why not (non-macOS,
 *   handle missing or invalid). Cheap: no osascript / TCC probe.
 * - `send(text)` — sends an iMessage to the configured handle.
 * - `ask(question, timeoutMs = 5min)` — sends `question` with a fresh 4-digit
 *   reply code and resolves with the answer from the first NEW message in the
 *   exact chat that starts with that code (the code is stripped). Resolves ''
 *   on timeout. Messages without the code, other questions' codes, and texts
 *   this bridge sent itself are never taken as the answer.
 */
export function createIMessageBridge(config: VoiceConductorImessageConfig): IMessageBridge {
  const platform = config.platform ?? process.platform
  const chatDbPath = config.chatDbPath ?? DEFAULT_CHAT_DB_PATH
  const pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const issuedCodes = new Set<string>()
  const outboundTexts = new Set<string>()

  function unavailableReason(): string | null {
    if (platform !== 'darwin') {
      return 'iMessage bridge unavailable: macOS only'
    }
    const handle = config.resolveHandle()?.trim() ?? ''
    if (!handle) {
      return IMESSAGE_HANDLE_MISSING
    }
    return isValidImessageHandle(handle) ? null : IMESSAGE_HANDLE_INVALID
  }

  function requireHandle(): string {
    const reason = unavailableReason()
    if (reason) {
      throw new Error(reason)
    }
    return (config.resolveHandle() ?? '').trim()
  }

  function rememberOutbound(text: string): void {
    if (outboundTexts.size >= MAX_REMEMBERED_OUTBOUND) {
      outboundTexts.clear()
    }
    outboundTexts.add(text.trim())
  }

  function issueCode(): string {
    if (issuedCodes.size >= MAX_REMEMBERED_CODES) {
      issuedCodes.clear()
    }
    let code: string
    do {
      code = String(crypto.randomInt(1000, 10_000))
    } while (issuedCodes.has(code))
    issuedCodes.add(code)
    return code
  }

  async function send(text: string): Promise<void> {
    const handle = requireHandle()
    rememberOutbound(text)
    await sendImessage(handle, text)
  }

  async function ask(question: string, timeoutMs = DEFAULT_ASK_TIMEOUT_MS): Promise<string> {
    const handle = requireHandle()
    // Open chat.db first so a missing Full Disk Access grant fails BEFORE we
    // text the user a question we could never read the answer to.
    const db = new SyncDatabase(chatDbPath, { readonly: true, fileMustExist: true })
    try {
      const baseline = maxRowid(db)
      const code = issueCode()
      const minutes = Math.max(1, Math.round(timeoutMs / 60_000))
      const outbound = `${question.trim()}\n\nReply "${code} <your answer>" within ${minutes} min.`
      rememberOutbound(outbound)
      await sendImessage(handle, outbound)

      const statement = db.prepare(NEW_REPLY_SQL)
      const spellings = JSON.stringify(selfHandleSpellings(handle))
      const deadline = Date.now() + timeoutMs
      let cursor = baseline

      while (Date.now() < deadline) {
        const rows = statement.all(cursor, spellings, spellings, spellings) as ReplyRow[]
        for (const row of rows) {
          cursor = Math.max(cursor, row.rowid)
          const text = extractChatDbMessageText(row)?.trim()
          if (!text || outboundTexts.has(text)) {
            continue
          }
          const answer = parseCodedReply(text, code)
          if (answer !== null) {
            return answer
          }
        }
        await delay(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())))
      }
      return ''
    } finally {
      db.close()
    }
  }

  return {
    isAvailable: () => unavailableReason() === null,
    unavailableReason,
    send,
    ask
  }
}
