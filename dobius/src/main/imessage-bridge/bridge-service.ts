import os from 'node:os'
import path from 'node:path'
import SyncDatabase from '../sqlite/sync-database'
import type {
  ImessageBridgeSendResult,
  ImessageBridgeStatus,
  ImessageBridgeChatDbProbe
} from '../../shared/imessage-bridge'
import { getImessageBridgeConfig, updateImessageBridgeConfig } from './bridge-config'
import { extractChatDbMessageText } from './chat-db-message-text'
import { countOutboundLastMinute, sendImessage } from './imessage-send'
import { isDobiusAuthoredRow } from './outbound-ring'
import { handleChannelMessage } from '../agents/agent-channel-service'
import { checkExecutionAdmission } from '../agents/execution-gate'
import type { PrepareClaudeLaunch } from '../agents/agent-runner'
import {
  assertSendAllowed,
  dispatchFailureReply,
  PAUSED_REPLY,
  type ImessageBridgeTerminalDispatcher
} from './terminal-send-guard'
import { selfHandleSpellings } from './self-handle-spellings'

export { getImessageBridgeConfig, updateImessageBridgeConfig } from './bridge-config'
export type { ImessageBridgeTerminalDispatcher } from './terminal-send-guard'

const CHAT_DB_PATH = path.join(os.homedir(), 'Library', 'Messages', 'chat.db')
const POLL_INTERVAL_MS = 2_000
const MAX_COMMAND_LENGTH = 4_000

// Self-thread filter: only messages the user sent (is_from_me) in the 1:1
// chat whose identifier exactly equals one spelling of their own handle
// (selfHandleSpellings). Why exact: a substring match on chat.guid also
// accepted longer numbers/emails containing the handle and group chats. Group
// chat guids carry ';+;' (1:1 chats carry ';-;'). Rows with no chat join fall
// back to an exact handle match, which covers the self-chat rows some macOS
// versions store without a chat link.
const NEW_MESSAGES_SQL = `
  SELECT message.ROWID AS rowid, message.text AS text, message.attributedBody AS attributedBody
  FROM message
  LEFT JOIN handle ON message.handle_id = handle.ROWID
  LEFT JOIN chat_message_join ON message.ROWID = chat_message_join.message_id
  LEFT JOIN chat ON chat_message_join.chat_id = chat.ROWID
  WHERE message.ROWID > ?
    AND message.is_from_me = 1
    AND (
      (chat.ROWID IS NOT NULL
        AND lower(chat.chat_identifier) IN (SELECT value FROM json_each(?))
        AND instr(chat.guid, ';+;') = 0)
      OR (chat.ROWID IS NULL AND lower(handle.id) IN (SELECT value FROM json_each(?)))
    )
  GROUP BY message.ROWID
  ORDER BY message.ROWID ASC
  LIMIT 50
`

type NewMessageRow = {
  rowid: number
  text: string | null
  attributedBody: Uint8Array | null
}

let dispatcher: ImessageBridgeTerminalDispatcher | null = null
let claudeLaunchPreparation: PrepareClaudeLaunch | null = null
let db: SyncDatabase.Database | null = null
let pollTimer: NodeJS.Timeout | null = null
let isPolling = false

function openChatDb(): SyncDatabase.Database {
  return new SyncDatabase(CHAT_DB_PATH, { readonly: true, fileMustExist: true })
}

/**
 * Start polling chat.db if the bridge is enabled and configured. Idempotent;
 * safe to call again after config changes. macOS only (chat.db + osascript).
 */
export function startImessageBridge(
  terminalDispatcher?: ImessageBridgeTerminalDispatcher,
  prepareClaudeLaunch?: PrepareClaudeLaunch
): void {
  if (terminalDispatcher) {
    dispatcher = terminalDispatcher
  }
  if (prepareClaudeLaunch) {
    claudeLaunchPreparation = prepareClaudeLaunch
  }
  if (pollTimer || process.platform !== 'darwin') {
    return
  }
  const config = getImessageBridgeConfig()
  if (!config.enabled) {
    return
  }
  if (!config.selfHandle) {
    console.warn('[imessage-bridge] enabled but no selfHandle configured; not starting')
    return
  }
  try {
    db = openChatDb()
  } catch (error) {
    console.warn(
      '[imessage-bridge] could not open chat.db (grant Full Disk Access in System Settings):',
      error instanceof Error ? error.message : String(error)
    )
    return
  }
  // Why: on first enable, jump the high-water mark to the newest row so the
  // entire message history is never replayed as commands.
  if (config.lastSeenRowid <= 0) {
    try {
      const row = db.prepare('SELECT COALESCE(MAX(ROWID), 0) AS maxRowid FROM message').get() as {
        maxRowid: number
      }
      updateImessageBridgeConfig({ lastSeenRowid: row.maxRowid })
    } catch (error) {
      console.warn(
        '[imessage-bridge] could not initialize lastSeenRowid:',
        error instanceof Error ? error.message : String(error)
      )
    }
  }
  pollTimer = setInterval(() => void pollNewMessages(), POLL_INTERVAL_MS)
  console.log(`[imessage-bridge] watching ${CHAT_DB_PATH} for handle ${config.selfHandle}`)
}

/** Stop polling and release the chat.db handle. Called on app quit. */
export function stopImessageBridge(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  if (db) {
    try {
      db.close()
    } catch {
      // Why: close() can throw if the underlying handle already died (e.g.
      // Messages.app vacuumed the DB); the bridge is shutting down either way.
    }
    db = null
  }
}

/** Restart after config changes (enable toggle, handle or prefix edits). */
export function restartImessageBridge(): void {
  stopImessageBridge()
  startImessageBridge()
}

function probeChatDb(): ImessageBridgeChatDbProbe {
  try {
    const probe = openChatDb()
    try {
      const row = probe.prepare('SELECT COUNT(*) AS messageCount FROM message').get() as {
        messageCount: number
      }
      return { ok: true, messageCount: row.messageCount }
    } finally {
      probe.close()
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function getImessageBridgeStatus(): ImessageBridgeStatus {
  const config = getImessageBridgeConfig()
  return {
    enabled: config.enabled,
    isRunning: pollTimer !== null,
    triggerPrefix: config.triggerPrefix,
    selfHandle: config.selfHandle,
    lastSeenRowid: config.lastSeenRowid,
    chatDbReadable:
      process.platform === 'darwin'
        ? probeChatDb()
        : { ok: false, error: 'iMessage bridge is only available on macOS' },
    outboundLastMin: countOutboundLastMinute()
  }
}

export async function testImessageSend(): Promise<ImessageBridgeSendResult> {
  const config = getImessageBridgeConfig()
  if (!config.selfHandle) {
    return { ok: false, error: 'selfHandle not configured' }
  }
  try {
    await sendImessage(config.selfHandle, 'Dobius iMessage bridge test: send pipeline works.')
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function readNewSelfMessages(
  database: SyncDatabase.Database,
  lastSeenRowid: number,
  selfHandle: string
): NewMessageRow[] {
  const spellings = JSON.stringify(selfHandleSpellings(selfHandle))
  return database
    .prepare(NEW_MESSAGES_SQL)
    .all(lastSeenRowid, spellings, spellings) as NewMessageRow[]
}

async function pollNewMessages(database: SyncDatabase.Database | null = db): Promise<void> {
  if (isPolling || !database) {
    return
  }
  isPolling = true
  try {
    const config = getImessageBridgeConfig()
    if (!config.selfHandle) {
      return
    }
    const rows = readNewSelfMessages(database, config.lastSeenRowid, config.selfHandle)
    for (const row of rows) {
      // Why: at-most-once. The watermark moves past this message BEFORE it can
      // type anything, so a later throw or a restart never re-types it. Skipped
      // non-command messages advance it too, so they are not re-scanned forever.
      updateImessageBridgeConfig({ lastSeenRowid: row.rowid })
      try {
        await handleIncomingMessage(row, config.selfHandle, config.triggerPrefix)
      } catch (error) {
        console.warn(
          `[imessage-bridge] message ${row.rowid} not processed:`,
          error instanceof Error ? error.message : String(error)
        )
      }
    }
  } catch (error) {
    console.warn(
      '[imessage-bridge] poll error:',
      error instanceof Error ? error.message : String(error)
    )
  } finally {
    isPolling = false
  }
}

async function handleIncomingMessage(
  row: NewMessageRow,
  selfHandle: string,
  triggerPrefix: string
): Promise<void> {
  const text = extractChatDbMessageText(row)?.trim()
  // Why: a conductor question or an agent's reply sits in this same self-chat;
  // only Carson's own texts may reach an agent or a terminal.
  if (!text || isDobiusAuthoredRow(text)) {
    return
  }
  if (await tryHandleChannelMessage(text, selfHandle)) {
    return
  }
  const command = matchTriggeredCommand(text, triggerPrefix)
  if (command) {
    // Why: awaited so two commands from one poll are never typed interleaved.
    await dispatchCommand(command, selfHandle)
  }
}

async function tryHandleChannelMessage(text: string, selfHandle: string): Promise<boolean> {
  if (!claudeLaunchPreparation) {
    return false
  }
  const result = await handleChannelMessage({
    text,
    replyHandle: selfHandle,
    prepareClaudeLaunch: claudeLaunchPreparation,
    sendReply: (reply) => sendImessage(selfHandle, reply)
  })
  return result === 'handled'
}

function matchTriggeredCommand(text: string, triggerPrefix: string): string | null {
  if (!text.toLowerCase().startsWith(triggerPrefix.toLowerCase())) {
    return null
  }
  const command = text.slice(triggerPrefix.length).trim()
  return command.length > 0 ? command : null
}

/**
 * Type the command into Dobius's active terminal and press Enter, then close the
 * loop with a short iMessage ack (or a hint when no terminal is available).
 * The target is pinned once (explicit handle, never re-resolved mid-send) and
 * only accepted while an agent is its foreground process and the crew is not
 * paused; both are rechecked before every write, including the Enter.
 */
async function dispatchCommand(
  command: string,
  selfHandle: string,
  target: ImessageBridgeTerminalDispatcher | null = dispatcher
): Promise<void> {
  // Why: refused, not queued — the watermark still advances, so a command sent
  // while paused is never replayed on resume.
  const admission = checkExecutionAdmission('imessage-command')
  if (!admission.allowed) {
    console.warn(`[imessage-bridge] command not sent: ${admission.reason}`)
    await sendImessage(selfHandle, PAUSED_REPLY).catch((error) => {
      console.warn(
        '[imessage-bridge] pause reply failed:',
        error instanceof Error ? error.message : String(error)
      )
    })
    return
  }
  const singleLine = command.replace(/[\r\n]+/g, ' ').slice(0, MAX_COMMAND_LENGTH)
  let typingStarted = false
  try {
    if (!target) {
      throw new Error('no_active_terminal')
    }
    const handle = await target.resolveActiveTerminal()
    await assertSendAllowed(target, handle)
    await target.sendTerminal(
      handle,
      { text: singleLine, enter: true },
      {
        beforeWrite: async () => {
          await assertSendAllowed(target, handle)
          typingStarted = true
        }
      }
    )
    console.log(`[imessage-bridge] dispatched to ${handle}`)
    await sendImessage(selfHandle, '(sent to the active Dobius+ terminal)')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[imessage-bridge] dispatch failed: ${message}`)
    const reply = dispatchFailureReply(message, typingStarted)
    await sendImessage(selfHandle, reply).catch(() => {
      // Why: the failure reply is best-effort; a rate-limit or Automation
      // permission error here must not crash the poll loop.
    })
  }
}

// Test seam only.
export const bridgeServiceInternals = { dispatchCommand, pollNewMessages, readNewSelfMessages }
