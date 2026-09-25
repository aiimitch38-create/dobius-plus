import { appendFile, open, stat } from 'node:fs/promises'
import path from 'node:path'
import { SafeJsonFile } from '../storage/safe-json-file'
import { getUserDataRoot } from '../storage/user-data-root'
import { resolveAdamToken } from '../adam-connection'
import { errorCode, postEventToAdam } from './adam-event-ingest'

// Byte offset into agent-events.ndjson: every line before it was delivered
// to ADAM or quarantined. Everything after it is pending.
type DeliveryCursor = { version: 1; offset: number }

export type AdamEventDeliveryState =
  | 'not-started'
  | 'idle'
  | 'delivering'
  | 'not-installed'
  | 'blocked-endpoint'
  | 'no-token'
  | 'unauthorized'
  | 'offline'
  | 'cursor-unreadable'
  | 'journal-error'

export type AdamEventDeliveryHealth = {
  state: AdamEventDeliveryState
  // Status code or errno only; never the token or event contents.
  detail: string | null
  deliveredCount: number
  quarantinedCount: number
  nextRetryAt: number | null
}

type DrainOutcome = 'caught-up' | 'retry'
type SendResult = 'delivered' | 'poison' | 'retry'

const READ_CHUNK_BYTES = 1024 * 1024
const RETRY_BASE_MS = 1_000
const RETRY_MAX_MS = 60_000
const CURSOR_SAVE_EVERY = 50

let deliveryStarted = false
let drainPromise: Promise<void> | null = null
let drainRequested = false
let retryTimer: ReturnType<typeof setTimeout> | null = null
let retryDelayMs = RETRY_BASE_MS
let loggedState: string | null = null
const health: AdamEventDeliveryHealth = {
  state: 'not-started',
  detail: null,
  deliveredCount: 0,
  quarantinedCount: 0,
  nextRetryAt: null
}

// Why: one root before and after app ready, so the drainer reads the same
// file the appender wrote (N4).
export function agentRunJournalPath(): string {
  return path.join(getUserDataRoot(), 'agent-events.ndjson')
}

function cursorPath(): string {
  return path.join(getUserDataRoot(), 'agent-events.cursor.json')
}

function quarantinePath(): string {
  return path.join(getUserDataRoot(), 'agent-events.quarantine.ndjson')
}

function parseCursor(raw: unknown): DeliveryCursor | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }
  const { version, offset } = raw as Partial<DeliveryCursor>
  return version === 1 && Number.isSafeInteger(offset) && (offset as number) >= 0
    ? { version: 1, offset: offset as number }
    : undefined
}

const cursorFile = new SafeJsonFile<DeliveryCursor>({
  filePath: cursorPath,
  parse: parseCursor,
  fallback: () => ({ version: 1, offset: 0 }),
  label: '[agents] agent-events.cursor.json'
})

function setHealth(state: AdamEventDeliveryState, detail: string | null): void {
  health.state = state
  health.detail = detail
  // Why: each retry pass passes through 'delivering'; only a real delivery
  // re-arms the warning, so an outage logs once instead of every backoff.
  if (state === 'idle' || state === 'delivering') {
    return
  }
  const key = `${state}:${detail ?? ''}`
  if (key === loggedState) {
    return
  }
  loggedState = key
  // Why: a paused queue must be visible (#79); the message names the state only.
  console.warn(
    `[agents] ADAM event delivery paused (${state}${detail ? `: ${detail}` : ''}); events stay queued in the journal`
  )
}

export function getAdamEventDeliveryHealth(): AdamEventDeliveryHealth {
  return { ...health }
}

/** Starts delivering pending journal events to ADAM. Call once the app store exists. */
export function startAgentRunEventDelivery(): void {
  if (deliveryStarted) {
    return
  }
  deliveryStarted = true
  setHealth('idle', null)
  requestAgentRunEventDelivery()
}

export async function whenAgentRunEventDeliveryIdle(): Promise<void> {
  while (drainPromise) {
    await drainPromise
  }
}

export function requestAgentRunEventDelivery(): void {
  // Why: while backing off, new events wait for the retry instead of hammering ADAM.
  if (!deliveryStarted || retryTimer) {
    return
  }
  if (drainPromise) {
    drainRequested = true
    return
  }
  drainPromise = runDrainLoop().finally(() => {
    drainPromise = null
  })
}

async function runDrainLoop(): Promise<void> {
  do {
    drainRequested = false
    let outcome: DrainOutcome
    try {
      outcome = await drainOnce()
    } catch (error) {
      setHealth('journal-error', errorCode(error))
      outcome = 'retry'
    }
    if (outcome === 'retry') {
      scheduleRetry()
      return
    }
    retryDelayMs = RETRY_BASE_MS
  } while (drainRequested)
  setHealth('idle', null)
}

// Bounded exponential backoff within the session (#80).
function scheduleRetry(): void {
  const delay = retryDelayMs
  retryDelayMs = Math.min(retryDelayMs * 2, RETRY_MAX_MS)
  health.nextRetryAt = Date.now() + delay
  retryTimer = setTimeout(() => {
    retryTimer = null
    health.nextRetryAt = null
    requestAgentRunEventDelivery()
  }, delay)
  retryTimer.unref()
}

async function drainOnce(): Promise<DrainOutcome> {
  const cursor = cursorFile.get()
  const cursorStatus = cursorFile.getStatus()
  if (cursorStatus.status === 'unreadable') {
    // Why: restarting from byte 0 would resend the whole journal; wait for repair.
    setHealth('cursor-unreadable', cursorStatus.detail)
    return 'retry'
  }
  let offset = cursor.offset
  let size: number
  try {
    size = (await stat(agentRunJournalPath())).size
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return 'caught-up'
    }
    throw error
  }
  if (size < offset) {
    // Why: the journal was replaced or truncated outside the app; its lines are new to us.
    console.warn('[agents] agent-events.ndjson is shorter than the delivery cursor; delivering from the start')
    offset = 0
    if (!saveCursor(0)) {
      return 'retry'
    }
  }
  if (size === offset) {
    return 'caught-up'
  }

  const tokenResult = await resolveAdamToken()
  if (tokenResult.token === undefined) {
    setHealth(tokenResult.state, tokenResult.detail)
    return 'retry'
  }
  if (typeof fetch !== 'function') {
    setHealth('offline', 'fetch unavailable')
    return 'retry'
  }
  setHealth('delivering', null)
  return deliverPending(offset, size, tokenResult.token)
}

async function deliverPending(start: number, size: number, token: string): Promise<DrainOutcome> {
  let offset = start
  let unsaved = 0
  // Why a batched cursor: one atomic write per event would block the main
  // process on a large backlog. A crash re-sends at most one batch, and ADAM
  // de-duplicates by eventId.
  while (offset < size) {
    const lines = await readCompleteLines(offset, size)
    if (lines.length === 0) {
      break
    }
    for (const { text, end } of lines) {
      if ((await deliverLine(text, offset, token)) === 'retry') {
        if (unsaved > 0) {
          saveCursor(offset)
        }
        return 'retry'
      }
      offset = end
      unsaved += 1
      if (unsaved >= CURSOR_SAVE_EVERY) {
        if (!saveCursor(offset)) {
          return 'retry'
        }
        unsaved = 0
      }
    }
  }
  if (unsaved > 0 && !saveCursor(offset)) {
    return 'retry'
  }
  return 'caught-up'
}

function saveCursor(offset: number): boolean {
  if (cursorFile.set({ version: 1, offset })) {
    return true
  }
  setHealth('journal-error', 'cursor not saved')
  return false
}

// Reads whole lines from `offset`; an in-progress trailing line is left for the next pass.
async function readCompleteLines(
  offset: number,
  size: number
): Promise<{ text: string; end: number }[]> {
  const handle = await open(agentRunJournalPath(), 'r')
  try {
    let length = Math.min(size - offset, READ_CHUNK_BYTES)
    let buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, offset)
    // Why: a single record larger than one chunk must still be read whole.
    while (!buffer.includes(0x0a) && offset + length < size) {
      length = Math.min(size - offset, length * 2)
      buffer = Buffer.alloc(length)
      await handle.read(buffer, 0, length, offset)
    }
    const lines: { text: string; end: number }[] = []
    let lineStart = 0
    let newline = buffer.indexOf(0x0a, lineStart)
    while (newline !== -1) {
      lines.push({
        text: buffer.subarray(lineStart, newline).toString('utf8'),
        end: offset + newline + 1
      })
      lineStart = newline + 1
      newline = buffer.indexOf(0x0a, lineStart)
    }
    return lines
  } finally {
    await handle.close()
  }
}

function parseRecord(text: string): { eventId: string } | undefined {
  try {
    const raw = JSON.parse(text) as { eventId?: unknown; eventType?: unknown } | null
    return raw && typeof raw.eventId === 'string' && typeof raw.eventType === 'string'
      ? { eventId: raw.eventId }
      : undefined
  } catch {
    return undefined
  }
}

async function deliverLine(text: string, offset: number, token: string): Promise<SendResult> {
  if (text.trim() === '') {
    return 'delivered'
  }
  if (!parseRecord(text)) {
    return (await quarantine(text, offset, 'unparseable record')) ? 'poison' : 'retry'
  }
  const result = await postEventToAdam(text, token)
  if (result.outcome === 'retry') {
    setHealth(result.state, result.detail)
    return 'retry'
  }
  if (result.outcome === 'poison') {
    return (await quarantine(text, offset, 'rejected by ADAM')) ? 'poison' : 'retry'
  }
  health.deliveredCount += 1
  loggedState = null
  return 'delivered'
}

// Keeps the bad line on disk so it is never lost; false means it could not be kept.
async function quarantine(text: string, offset: number, reason: string): Promise<boolean> {
  const entry = { quarantinedAt: new Date().toISOString(), reason, offset, line: text }
  try {
    await appendFile(quarantinePath(), `${JSON.stringify(entry)}\n`, 'utf8')
  } catch (error) {
    setHealth('journal-error', `quarantine ${errorCode(error)}`)
    return false
  }
  health.quarantinedCount += 1
  console.warn(`[agents] quarantined journal record at byte ${offset} (${reason})`)
  return true
}
