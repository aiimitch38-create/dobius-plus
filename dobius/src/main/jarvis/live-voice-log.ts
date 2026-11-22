import { appendFileSync, existsSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { getUserDataRoot } from '../storage/user-data-root'

const MAX_LOG_BYTES = 256_000
const MAX_LINE_CHARS = 500

/** Cleans one log line: no key-shaped text, no line breaks, bounded length. */
export function cleanLiveVoiceLogText(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_\-*.]{3,}/g, '[hidden]')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, MAX_LINE_CHARS)
}

/**
 * Appends a live voice failure to live-voice-errors.log in the Dobius+ data folder.
 * Why a file: the error otherwise only reaches an orb caption that is easy to miss.
 */
export function logLiveVoiceProblem(source: string, text: string): void {
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
