import type {
  RuntimeTerminalTranscriptMessage,
  RuntimeTerminalTranscriptRead
} from '../../shared/runtime-types'
import { clampLimit } from './terminal-read-views'
import { openConfinedTranscriptFile } from './transcript-path-guard'

// Why: the terminal screen only shows what fits and redraws; the agent's own
// JSONL transcript is the reliable record of what it said. Read-only.

export const DEFAULT_TRANSCRIPT_READ_LIMIT = 10
export const MAX_TRANSCRIPT_READ_LIMIT = 200
export const TRANSCRIPT_TAIL_SCAN_BYTES = 4 * 1024 * 1024
export const TRANSCRIPT_MESSAGE_HEAD_CHARS = 1500
export const TRANSCRIPT_MESSAGE_TAIL_CHARS = 2500

type TranscriptAgent = 'claude' | 'codex'

type DecodedTextRecord = {
  role: 'user' | 'assistant'
  text: string
  timestamp: number | null
  /** Claude splits one assistant message into one record per content block;
   *  records sharing this id are the same message. */
  mergeKey: string | null
  /** Codex writes many turns twice (response_item and event_msg). */
  kind?: 'response' | 'event'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function textOfContent(content: unknown, textTypes: ReadonlySet<string>): string {
  if (typeof content === 'string') {
    return content.trim()
  }
  if (!Array.isArray(content)) {
    return ''
  }
  const parts: string[] = []
  for (const item of content) {
    const record = asRecord(item)
    // Why: only prose blocks. thinking/tool_use/tool_result/image are not what
    // the agent "said", and thinking must never be presented as a reply.
    if (record && typeof record.type === 'string' && textTypes.has(record.type)) {
      const text = typeof record.text === 'string' ? record.text.trim() : ''
      if (text) {
        parts.push(text)
      }
    }
  }
  return parts.join('\n\n')
}

const CLAUDE_TEXT_TYPES = new Set(['text'])
const CODEX_TEXT_TYPES = new Set(['text', 'input_text', 'output_text'])

export function decodeClaudeTextRecord(line: string): DecodedTextRecord | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }
  const record = asRecord(parsed)
  if (!record || (record.type !== 'user' && record.type !== 'assistant')) {
    return null
  }
  // Why: sidechain records are sub-agent conversations, and meta records are
  // harness-injected caveats, not turns of this agent's conversation.
  if (record.isSidechain === true || record.isMeta === true) {
    return null
  }
  const message = asRecord(record.message)
  const text = textOfContent(message?.content, CLAUDE_TEXT_TYPES)
  if (!text) {
    return null
  }
  const messageId = typeof message?.id === 'string' ? message.id : null
  return {
    role: record.type,
    text,
    timestamp: parseTimestamp(record.timestamp),
    mergeKey: record.type === 'assistant' ? messageId : null
  }
}

export function decodeCodexTextRecord(line: string): DecodedTextRecord | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }
  const record = asRecord(parsed)
  const payload = asRecord(record?.payload)
  if (record?.type === 'event_msg' && payload) {
    return decodeCodexEventMessage(payload, parseTimestamp(record.timestamp))
  }
  if (!record || record.type !== 'response_item' || payload?.type !== 'message') {
    return null
  }
  if (payload.role !== 'user' && payload.role !== 'assistant') {
    return null
  }
  const text = textOfContent(payload.content, CODEX_TEXT_TYPES)
  if (!text) {
    return null
  }
  return {
    role: payload.role,
    text,
    timestamp: parseTimestamp(record.timestamp),
    mergeKey: null,
    kind: 'response'
  }
}

function decodeCodexEventMessage(
  payload: Record<string, unknown>,
  timestamp: number | null
): DecodedTextRecord | null {
  const role =
    payload.type === 'user_message' ? 'user' : payload.type === 'agent_message' ? 'assistant' : null
  const text = typeof payload.message === 'string' ? payload.message.trim() : ''
  if (!role || !text) {
    return null
  }
  return { role, text, timestamp, mergeKey: null, kind: 'event' }
}

const CODEX_DUPLICATE_LOOKBACK = 4

// Why: when Codex records a turn both as a response_item and as an event_msg,
// show it once. Only a nearby copy from the OTHER representation counts, so a
// user genuinely repeating the same prompt is still shown twice.
function isCodexDuplicate(messages: DecodedTextRecord[], next: DecodedTextRecord): boolean {
  if (!next.kind) {
    return false
  }
  for (
    let index = messages.length - 1;
    index >= 0 && index >= messages.length - CODEX_DUPLICATE_LOOKBACK;
    index -= 1
  ) {
    const earlier = messages[index]!
    if (
      earlier.kind &&
      earlier.kind !== next.kind &&
      earlier.role === next.role &&
      earlier.text === next.text
    ) {
      return true
    }
  }
  return false
}

function clipMessage(
  text: string
): Pick<RuntimeTerminalTranscriptMessage, 'text' | 'clipped' | 'chars'> {
  const max = TRANSCRIPT_MESSAGE_HEAD_CHARS + TRANSCRIPT_MESSAGE_TAIL_CHARS
  if (text.length <= max) {
    return { text, clipped: false, chars: text.length }
  }
  // Why keep both ends: the head says what the reply is about, the tail is
  // usually the conclusion an operator asks about.
  const omitted = text.length - max
  return {
    text: `${text.slice(0, TRANSCRIPT_MESSAGE_HEAD_CHARS)}\n[… ${omitted} chars omitted …]\n${text.slice(-TRANSCRIPT_MESSAGE_TAIL_CHARS)}`,
    clipped: true,
    chars: text.length
  }
}

/** Decode transcript JSONL lines into ordered, merged, role-labeled text messages. */
export function extractTranscriptTextMessages(
  agent: TranscriptAgent,
  lines: readonly string[]
): DecodedTextRecord[] {
  const decode = agent === 'claude' ? decodeClaudeTextRecord : decodeCodexTextRecord
  const messages: DecodedTextRecord[] = []
  for (const line of lines) {
    if (!line.trim()) {
      continue
    }
    const decoded = decode(line)
    if (!decoded) {
      continue
    }
    if (isCodexDuplicate(messages, decoded)) {
      continue
    }
    const previous = messages.at(-1)
    if (
      previous &&
      decoded.mergeKey !== null &&
      previous.mergeKey === decoded.mergeKey &&
      previous.role === decoded.role
    ) {
      previous.text = `${previous.text}\n\n${decoded.text}`
      continue
    }
    messages.push({ ...decoded })
  }
  return messages
}

/**
 * Read the most recent text messages from an agent transcript without parsing
 * the whole file: only the last `maxBytes` are scanned, which bounds work on
 * multi-megabyte transcripts. Read-only.
 */
export async function readAgentTranscriptTail(args: {
  agent: string
  path: string
  sessionId: string | null
  /** Only files inside these folders are read (see transcript-path-guard.ts). */
  allowedRoots: readonly string[]
  limit?: number
  maxBytes?: number
}): Promise<RuntimeTerminalTranscriptRead> {
  const base = { source: 'transcript' as const, agent: args.agent, sessionId: args.sessionId }
  if (args.agent !== 'claude' && args.agent !== 'codex') {
    return {
      ...base,
      available: false,
      path: args.path,
      reason: `transcript reading is not supported for agent "${args.agent}"`
    }
  }
  const limit = clampLimit(args.limit, DEFAULT_TRANSCRIPT_READ_LIMIT, MAX_TRANSCRIPT_READ_LIMIT)
  const maxBytes = Math.max(1024, args.maxBytes ?? TRANSCRIPT_TAIL_SCAN_BYTES)
  const opened = await openConfinedTranscriptFile(args.path, args.allowedRoots)
  if ('reason' in opened) {
    return { ...base, available: false, path: args.path, reason: opened.reason }
  }
  const fileBytes = opened.size
  const start = Math.max(0, fileBytes - maxBytes)
  const length = fileBytes - start
  let raw = ''
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await opened.handle.read(buffer, 0, length, start)
    raw = buffer.subarray(0, bytesRead).toString('utf8')
  } catch (err) {
    return {
      ...base,
      available: false,
      path: opened.canonicalPath,
      reason: `transcript unreadable: ${err instanceof Error ? err.message : String(err)}`
    }
  } finally {
    await opened.handle.close()
  }
  const lines = raw.split('\n')
  // Why: a window that starts mid-file starts mid-record; that first fragment
  // cannot be parsed and is dropped rather than misread.
  if (start > 0) {
    lines.shift()
  }
  const decoded = extractTranscriptTextMessages(args.agent, lines)
  const recent = decoded.slice(-limit)
  return {
    ...base,
    available: true,
    path: opened.canonicalPath,
    messages: recent.map((message) => ({
      role: message.role,
      timestamp: message.timestamp,
      ...clipMessage(message.text)
    })),
    olderMessagesOmitted: start > 0 || decoded.length > recent.length,
    fileBytes,
    scannedBytes: length
  }
}
