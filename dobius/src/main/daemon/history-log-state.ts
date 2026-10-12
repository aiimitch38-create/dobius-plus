import { join } from 'node:path'
import {
  closeSync,
  fstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
  unlinkSync
} from 'node:fs'
import { decodeLogHeader, LOG_HEADER_BYTES } from './terminal-history-log'

export type SessionWriter = {
  dir: string
  checkpointPath: string
  logPath: string
  /** Generation of the on-disk log header. Null until lazily resolved on the
   *  first append after a warm registerWriter (the file may predate us). */
  logGeneration: number | null
  /** Current log file size. Null until lazily resolved alongside generation. */
  logBytes: number | null
}

function readCheckpointGeneration(writer: SessionWriter): number | null {
  try {
    const checkpoint = JSON.parse(readFileSync(writer.checkpointPath, 'utf-8'))
    return typeof checkpoint.generation === 'number' ? checkpoint.generation : null
  } catch {
    return null
  }
}

// Why: a warm registerWriter may attach to a session dir that already has a
// log (app relaunch while the daemon kept running). Generation and size are
// read from disk once so appends continue the existing stream instead of
// clobbering it.
export function resolveLogState(writer: SessionWriter): void {
  if (writer.logBytes !== null && writer.logGeneration !== null) {
    return
  }
  let headerGeneration: number | null = null
  let size = 0
  try {
    const fd = openSync(writer.logPath, 'r')
    try {
      size = fstatSync(fd).size
      const header = Buffer.alloc(LOG_HEADER_BYTES)
      if (readSync(fd, header, 0, LOG_HEADER_BYTES, 0) === LOG_HEADER_BYTES) {
        headerGeneration = decodeLogHeader(header)
      }
    } finally {
      closeSync(fd)
    }
  } catch {
    // Missing log file — fresh state below.
  }
  if (headerGeneration !== null) {
    writer.logGeneration = headerGeneration
    writer.logBytes = size
    return
  }
  // Missing or unreadable header: logBytes = 0 makes the next append rewrite
  // the file from scratch (writeFile truncates), so a garbage file cannot be
  // extended.
  writer.logBytes = 0
  writer.logGeneration = readCheckpointGeneration(writer) ?? 0
}

const STALE_TMP_AGE_MS = 10 * 60 * 1000
const CHECKPOINT_TMP = /^checkpoint\.json\.(?:[\w-]+\.)?tmp$/

/** Removes checkpoint tmp files left by a crash. Readers only open
 *  checkpoint.json, so leftovers are harmless; the age gate keeps any write
 *  still in flight (e.g. a detached final checkpoint) untouched. */
export function removeStaleCheckpointTmps(dir: string, now: number): void {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return
  }
  for (const name of names.filter((entry) => CHECKPOINT_TMP.test(entry))) {
    const file = join(dir, name)
    try {
      if (now - statSync(file).mtimeMs >= STALE_TMP_AGE_MS) {
        unlinkSync(file)
      }
    } catch (error) {
      console.warn(
        '[history] could not remove stale checkpoint tmp:',
        (error as NodeJS.ErrnoException).code
      )
    }
  }
}
