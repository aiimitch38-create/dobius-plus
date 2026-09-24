import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { readSafeJsonFile } from '../storage/safe-json-file'
import { getHistorySessionDirName } from './history-paths'

// Why: the spawn probe race can still cold-restore a session whose endedAt was
// written moments earlier (detectColdRestore ignoreCleanEnd), so a just-ended
// session is never eligible for the retention sweep.
const RETENTION_MIN_ENDED_AGE_MS = 10 * 60 * 1000
const DELETING_PREFIX = '.deleting-'

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

type ScanResult = {
  totalBytes: number
  candidates: RetentionCandidate[]
  candidateBytes: number
  leftovers: RetentionCandidate[]
}

function scanHistoryRoot(basePath: string, liveDirs: ReadonlySet<string>, now: number): ScanResult {
  const scan: ScanResult = { totalBytes: 0, candidates: [], candidateBytes: 0, leftovers: [] }
  for (const entry of readdirSync(basePath, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }
    const dir = join(basePath, entry.name)
    const bytes = directoryBytes(dir)
    scan.totalBytes += bytes
    const endedAt = readEndedAt(dir)
    if (typeof endedAt !== 'string' || liveDirs.has(dir)) {
      continue
    }
    const endedAtMs = Date.parse(endedAt)
    if (entry.name.startsWith(DELETING_PREFIX)) {
      // Why: a sweep interrupted after its rename; only ended leftovers go.
      scan.leftovers.push({ dir, endedAt, endedAtMs, bytes })
    } else if (Number.isFinite(endedAtMs) && now - endedAtMs >= RETENTION_MIN_ENDED_AGE_MS) {
      scan.candidates.push({ dir, endedAt, endedAtMs, bytes })
      scan.candidateBytes += bytes
    }
  }
  return scan
}

// Why rename first: the daemon (another process) may reopen this session id
// at any moment. Once the dir is moved aside, a reopen writes to a fresh dir,
// so the re-check inside the moved dir is final.
function removeIfStillEnded(basePath: string, candidate: RetentionCandidate): boolean {
  const moved = join(basePath, `${DELETING_PREFIX}${randomBytes(6).toString('hex')}`)
  renameSync(candidate.dir, moved)
  if (readEndedAt(moved) !== candidate.endedAt) {
    renameSync(moved, candidate.dir)
    return false
  }
  rmSync(moved, { recursive: true, force: true })
  return true
}

/** Deletes ended sessions, oldest endedAt first, until the archive fits in
 *  maxTotalBytes. Sessions without a clean endedAt (live, hibernated, or
 *  crashed and awaiting cold restore), unreadable metadata and `liveDirs` are
 *  never deleted. If those alone exceed the quota, nothing is deleted. A scan
 *  error throws before anything is removed. */
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
  const scan = scanHistoryRoot(basePath, liveDirs, now)
  result.totalBytes = scan.totalBytes
  for (const leftover of scan.leftovers) {
    rmSync(leftover.dir, { recursive: true, force: true })
    result.freedBytes += leftover.bytes
  }
  const keptBytes = scan.totalBytes - scan.candidateBytes - result.freedBytes
  if (keptBytes > maxTotalBytes) {
    console.warn(
      `[history] retention skipped: ${keptBytes} bytes of non-deletable history already exceed the ${maxTotalBytes}-byte quota`
    )
    return result
  }
  const budget = maxTotalBytes - keptBytes
  let remaining = scan.candidateBytes
  scan.candidates.sort((a, b) => a.endedAtMs - b.endedAtMs)
  for (const candidate of scan.candidates) {
    if (remaining <= budget) {
      break
    }
    if (removeIfStillEnded(basePath, candidate)) {
      remaining -= candidate.bytes
      result.removedSessions++
      result.freedBytes += candidate.bytes
    }
  }
  return result
}

type LiveSessionSource = { listProcesses(): Promise<{ id: string }[]> }

/** Production entry point: reads the quota, asks the daemon provider which
 *  sessions are alive, then sweeps. Returns null when the sweep was skipped.
 *  Why skip without a live list: without it a session whose id was reused
 *  could look ended, so the sweep fails closed. */
export async function runHistoryRetentionSweep(
  provider: LiveSessionSource | null,
  historyDir: string,
  quotaPath: string,
  now = Date.now()
): Promise<HistoryRetentionResult | null> {
  const maxTotalBytes = readHistoryRetentionQuotaBytes(quotaPath)
  if (maxTotalBytes === null) {
    return null
  }
  if (!provider) {
    console.warn('[history] retention skipped: daemon provider unavailable')
    return null
  }
  let live: { id: string }[]
  try {
    live = await provider.listProcesses()
  } catch (error) {
    console.warn('[history] retention skipped: could not list live daemon sessions:', error)
    return null
  }
  const liveDirs = new Set(
    live.map((session) => join(historyDir, getHistorySessionDirName(session.id)))
  )
  return sweepEndedHistory(historyDir, maxTotalBytes, liveDirs, now)
}
