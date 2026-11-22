import { appendFileSync, existsSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { getUserDataRoot } from '../storage/user-data-root'

const MAX_LOG_BYTES = 256_000
const MAX_LINE_CHARS = 500

/** Cleans one log line: no key-shaped text, no line breaks, bounded length. */
export function cleanLiveVoiceLogText(text: string): string {
  return text
    .slice(0, MAX_LINE_CHARS * 4)
    .replace(/sk-[A-Za-z0-9_\-*.]{3,}/g, '[hidden]')
    .replace(/ek_[A-Za-z0-9_-]{6,}/g, '[hidden]')
    .replace(/(ice-(?:pwd|ufrag)|fingerprint)[:=]\S+/gi, '$1:[hidden]')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, MAX_LINE_CHARS)
}

/**
 * Appends a live voice failure to live-voice-errors.log in the Dobius+ data folder.
 * Why a file: the error otherwise only reaches an orb caption that is easy to miss.
 */
// ponytail: one global budget per minute, per-sender limits if several windows ever log.
const LINES_PER_MINUTE = 30
let windowStart = 0
let linesInWindow = 0

export function logLiveVoiceProblem(source: string, text: string, now = Date.now()): void {
  if (now - windowStart > 60_000) {
    windowStart = now
    linesInWindow = 0
  }
  if (++linesInWindow > LINES_PER_MINUTE) {
    return
  }
  try {
    const path = join(getUserDataRoot(), 'live-voice-errors.log')
    // ponytail: one rotated copy, enough for debugging a call.
    if (existsSync(path) && statSync(path).size > MAX_LOG_BYTES) {
      renameSync(path, `${path}.1`)
    }
    appendFileSync(path, `${new Date().toISOString()} ${source} ${cleanLiveVoiceLogText(text)}\n`)
  } catch (error) {
    console.warn('[live-voice] could not write the error log:', error)
  }
}
