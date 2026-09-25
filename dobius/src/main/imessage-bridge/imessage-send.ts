import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { recordOutbound } from './outbound-ring'

const execFileAsync = promisify(execFile)

const OSASCRIPT_TIMEOUT_MS = 10_000
const OUTBOUND_RATE_LIMIT_PER_MIN = 10
const OUTBOUND_WINDOW_MS = 60_000

// Sliding window of outbound send timestamps for the rate limit.
let outboundTimestamps: number[] = []

function pruneOutboundWindow(now: number): void {
  outboundTimestamps = outboundTimestamps.filter((sentAt) => now - sentAt < OUTBOUND_WINDOW_MS)
}

export function countOutboundLastMinute(): number {
  pruneOutboundWindow(Date.now())
  return outboundTimestamps.length
}

// Why: the handle and text reach AppleScript as run-handler arguments, never
// spliced into the script source, so no quote or backslash can change it.
const SEND_SCRIPT = [
  'on run argv',
  'set targetHandle to item 1 of argv',
  'set messageText to item 2 of argv',
  'tell application "Messages"',
  'set targetService to 1st service whose service type = iMessage',
  'set targetBuddy to participant targetHandle of targetService',
  'send messageText to targetBuddy',
  'end tell',
  'end run'
].join('\n')

// A phone number (digits with optional +, spaces, dashes, dots, parens) or an
// email address. Anything else is refused before osascript runs.
const PHONE_HANDLE = /^\+?[0-9][0-9 ().-]{1,30}$/
const EMAIL_HANDLE = /^[^\s@"\\]+@[^\s@"\\]+\.[^\s@"\\]+$/

export function isValidImessageHandle(handle: string): boolean {
  // Why: a leading '-' would be read by osascript as an option, not an argument.
  if (handle.startsWith('-')) {
    return false
  }
  return PHONE_HANDLE.test(handle) || EMAIL_HANDLE.test(handle)
}

export function stripControlChars(text: string): string {
  // Why: keep the old literal's rule (drop control chars except newline); a
  // NUL would also make execFile reject the argument.
  // eslint-disable-next-line no-control-regex -- control chars are exactly what is being removed
  return text.replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '')
}

/**
 * Send an iMessage to `handle` via Messages.app (osascript). Rate-limited to
 * OUTBOUND_RATE_LIMIT_PER_MIN so a dispatch loop can never spam the user.
 * Requires macOS Automation permission for Messages.app (prompted on first send).
 */
export async function sendImessage(handle: string, text: string): Promise<void> {
  if (!handle) {
    throw new Error('selfHandle not configured')
  }
  if (!isValidImessageHandle(handle)) {
    throw new Error('iMessage handle must be a phone number or email address')
  }
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('text required')
  }
  const now = Date.now()
  pruneOutboundWindow(now)
  if (outboundTimestamps.length >= OUTBOUND_RATE_LIMIT_PER_MIN) {
    throw new Error(`outbound rate limit (${OUTBOUND_RATE_LIMIT_PER_MIN}/min) exceeded`)
  }
  outboundTimestamps.push(now)
  const body = stripControlChars(text)
  recordOutbound(body, now)

  const { stderr } = await execFileAsync(
    '/usr/bin/osascript',
    // '--' ends osascript's option parsing, so no argument is ever read as a flag.
    ['-e', SEND_SCRIPT, '--', handle, body],
    { timeout: OSASCRIPT_TIMEOUT_MS }
  )
  if (stderr) {
    console.warn(`[imessage-bridge] osascript stderr: ${stderr}`)
  }
}
