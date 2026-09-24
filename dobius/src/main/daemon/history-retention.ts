import { join } from 'node:path'
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { readSafeJsonFile } from '../storage/safe-json-file'

// Why: the spawn probe race can still cold-restore a session whose endedAt was
// written moments earlier (detectColdRestore ignoreCleanEnd), so a just-ended
// session is never eligible for the retention sweep.
const RETENTION_MIN_ENDED_AGE_MS = 10 * 60 * 1000

export type HistoryRetentionResult = {
  totalBytes: number
  removedSessions: number
  freedBytes: number
}

type RetentionCandidate = { dir: string; endedAt: string; endedAtMs: number; bytes: number }

/** Reads the terminal-history quota file. Returns null (retention off) when
 *  the file is missing, unreadable, or has no positive `maxTotalMB`. */
export function readHistoryRetentionQuotaBytes(filePath: string): number | null {
  const result = readSafeJsonFile<number | null>(
    filePath,
    (raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return undefined
      }
      const maxTotalMB = (raw as { maxTotalMB?: unknown }).maxTotalMB
      if (maxTotalMB === undefined || maxTotalMB === null) {
        return null
      }
      return typeof maxTotalMB === 'number' && Number.isFinite(maxTotalMB) && maxTotalMB > 0
        ? maxTotalMB * 1024 * 1024
        : undefined
    },
    () => null
  )
  if (result.status === 'unreadable') {
    console.warn(`[history] retention disabled: ${filePath} is unreadable (${result.detail})`)
  }
  return result.value
}

function directoryBytes(dir: string): number {
  let bytes = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile()) {
      bytes += statSync(join(dir, entry.name)).size
    }
  }
  return bytes
}

// Why unknown on any failure: a missing or torn meta.json means we cannot
// prove the session ended, so the sweep must leave it alone.
function readEndedAt(dir: string): unknown {
  try {
    const meta: unknown = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf-8'))
    return meta && typeof meta === 'object' ? (meta as { endedAt?: unknown }).endedAt : undefined
  } catch {
    return undefined
  }
}

/** Deletes ended sessions, oldest endedAt first, until the archive fits in
 *  maxTotalBytes. Sessions without a clean endedAt (live, hibernated, or
 *  crashed and awaiting cold restore), unreadable metadata and `liveDirs` are
 *  never deleted. A scan error throws before anything is removed. */
export function sweepEndedHistory(
  basePath: string,
  maxTotalBytes: number,
  liveDirs: ReadonlySet<string>,
  now: number
): HistoryRetentionResult {
  const result: HistoryRetentionResult = { totalBytes: 0, removedSessions: 0, freedBytes: 0 }
  if (!existsSync(basePath)) {
    return result
  }
  const candidates: RetentionCandidate[] = []
  for (const entry of readdirSync(basePath, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }
    const dir = join(basePath, entry.name)
    const bytes = directoryBytes(dir)
    result.totalBytes += bytes
    const endedAt = readEndedAt(dir)
    if (typeof endedAt !== 'string' || liveDirs.has(dir)) {
      continue
    }
    const endedAtMs = Date.parse(endedAt)
    if (Number.isFinite(endedAtMs) && now - endedAtMs >= RETENTION_MIN_ENDED_AGE_MS) {
      candidates.push({ dir, endedAt, endedAtMs, bytes })
    }
  }
  candidates.sort((a, b) => a.endedAtMs - b.endedAtMs)
  for (const candidate of candidates) {
    if (result.totalBytes - result.freedBytes <= maxTotalBytes) {
      break
    }
    // Why re-read: the daemon may have reopened this session id (fresh
    // endedAt: null) after the scan; that session is live again.
    if (readEndedAt(candidate.dir) !== candidate.endedAt) {
      continue
    }
    rmSync(candidate.dir, { recursive: true, force: true })
    result.removedSessions++
    result.freedBytes += candidate.bytes
  }
  return result
}
