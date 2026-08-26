import { appendFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Best-effort file trace for the Jarvis pipeline. Why a file: packaged
 * Electron console output goes to /dev/null, so pipeline debugging was blind.
 * Every line is timestamped; failures never throw into the voice path.
 */
export function jarvisTrace(event: string, detail?: Record<string, unknown>): void {
  try {
    const dir = process.env.DOBIUS_USER_DATA_PATH
    if (!dir) {
      return
    }
    const line = `${new Date().toISOString()} ${event}${detail ? ' ' + JSON.stringify(detail) : ''}\n`
    appendFileSync(join(dir, 'jarvis-trace.log'), line)
  } catch {
    // Tracing must never break the voice loop.
  }
}
