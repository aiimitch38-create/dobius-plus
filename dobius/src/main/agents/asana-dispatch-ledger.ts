import path from 'node:path'
import type { AsanaLane } from '../../shared/asana'
import { parseEveryEntry, SafeJsonFile } from '../storage/safe-json-file'
import { getUserDataRoot } from '../storage/user-data-root'

const FILE_NAME = 'asana-dispatch-ledger.json'
const MAX_ATTEMPTS = 2
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export type AsanaDispatchRecord = {
  gid: string
  lane: AsanaLane
  firstSeenAt: number
  lastAttemptAt: number
  attempts: number
  status: 'claimed' | 'briefed' | 'failed' | 'dead'
  /** Set once a build worktree was dispatched (or its outcome is unknown) for this task. */
  buildDispatchedAt?: number
}

function filePath(): string {
  return path.join(getUserDataRoot(), FILE_NAME)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

// Why: a dropped record (above all one carrying buildDispatchedAt) makes its
// task look new and re-dispatches a paid build, so any malformed record makes
// the whole ledger unreadable: claimTask and mayDispatchBuild then fail closed.
// Every writer since caee2df0 sets all six required fields.
function sanitizeRecord(raw: unknown): AsanaDispatchRecord | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null
  }
  const record = raw as Partial<Record<keyof AsanaDispatchRecord, unknown>>
  const gid = typeof record.gid === 'string' ? record.gid.trim() : ''
  const lane = record.lane === 'build' || record.lane === 'review' ? record.lane : null
  const status =
    record.status === 'claimed' ||
    record.status === 'briefed' ||
    record.status === 'failed' ||
    record.status === 'dead'
      ? record.status
      : null
  const { firstSeenAt, lastAttemptAt, attempts, buildDispatchedAt } = record
  if (
    !gid ||
    !lane ||
    !status ||
    !isFiniteNumber(firstSeenAt) ||
    !isFiniteNumber(lastAttemptAt) ||
    !isFiniteNumber(attempts) ||
    attempts < 0 ||
    (buildDispatchedAt !== undefined && !isFiniteNumber(buildDispatchedAt))
  ) {
    return null
  }
  return {
    gid,
    lane,
    firstSeenAt,
    lastAttemptAt,
    attempts: Math.floor(attempts),
    status,
    ...(buildDispatchedAt === undefined ? {} : { buildDispatchedAt })
  }
}

const file = new SafeJsonFile<AsanaDispatchRecord[]>({
  filePath,
  parse: (raw) => (Array.isArray(raw) ? parseEveryEntry(raw, sanitizeRecord) : undefined),
  fallback: () => [],
  label: '[agents] asana-dispatch-ledger.json'
})

function load(): AsanaDispatchRecord[] {
  return file.get()
}

function persist(records: AsanaDispatchRecord[]): void {
  file.set(records)
}

function findRecord(gid: string): AsanaDispatchRecord | undefined {
  return load().find((record) => record.gid === gid)
}

function cloneRecord(record: AsanaDispatchRecord): AsanaDispatchRecord {
  return { ...record }
}

export function hasBeenClaimed(gid: string): boolean {
  const record = findRecord(gid)
  return record?.status === 'claimed' || record?.status === 'briefed' || record?.status === 'dead'
}

export function claimTask(gid: string, lane: AsanaLane): AsanaDispatchRecord | null {
  // Why: a task whose build was already dispatched is done-for-dispatch; a
  // retried triage must not launch a second worktree + terminal agent.
  if (hasBeenClaimed(gid) || isDead(gid) || findRecord(gid)?.buildDispatchedAt !== undefined) {
    return null
  }
  // Why: an unreadable ledger may hold this task's claim; re-dispatching would start a duplicate paid run.
  if (file.getStatus().status === 'unreadable') {
    return null
  }
  const records = load()
  const existing = records.find((record) => record.gid === gid)
  const now = Date.now()
  if (existing) {
    // Why: failed records are the only retryable state; reclaiming preserves
    // the original edge timestamp while reserving this retry attempt.
    existing.status = 'claimed'
    existing.lane = lane
    existing.lastAttemptAt = now
    persist(records)
    return cloneRecord(existing)
  }
  const record: AsanaDispatchRecord = {
    gid,
    lane,
    firstSeenAt: now,
    lastAttemptAt: now,
    attempts: 0,
    status: 'claimed'
  }
  persist([...records, record])
  return cloneRecord(record)
}

export function recordBriefed(gid: string): AsanaDispatchRecord | null {
  const record = findRecord(gid)
  if (!record) {
    return null
  }
  record.status = record.status === 'dead' ? 'dead' : 'briefed'
  record.lastAttemptAt = Date.now()
  persist(load())
  return cloneRecord(record)
}

export function recordFailure(gid: string): AsanaDispatchRecord | null {
  const record = findRecord(gid)
  if (!record) {
    return null
  }
  if (record.status === 'dead') {
    return cloneRecord(record)
  }
  record.attempts += 1
  record.lastAttemptAt = Date.now()
  record.status = record.attempts >= MAX_ATTEMPTS ? 'dead' : 'failed'
  persist(load())
  return cloneRecord(record)
}

// Why: a start refused by the execution gate is not a failed attempt, so it
// must not move the task toward 'dead'.
export function releaseClaim(gid: string): AsanaDispatchRecord | null {
  const records = load()
  const record = records.find((entry) => entry.gid === gid)
  if (!record || record.status !== 'claimed') {
    return record ? cloneRecord(record) : null
  }
  if (record.attempts === 0) {
    persist(records.filter((entry) => entry !== record))
    return null
  }
  record.status = 'failed'
  persist(records)
  return cloneRecord(record)
}

/** Fails closed: an unreadable ledger may already record this task's build. */
export function mayDispatchBuild(gid: string): boolean {
  const record = findRecord(gid)
  // getStatus reflects the read findRecord just did.
  if (file.getStatus().status === 'unreadable') {
    return false
  }
  return record?.buildDispatchedAt === undefined
}

export function recordBuildDispatched(gid: string, lane: AsanaLane = 'build'): boolean {
  const records = load()
  const now = Date.now()
  const record = records.find((entry) => entry.gid === gid)
  if (record) {
    record.buildDispatchedAt = now
    return file.set(records)
  }
  return file.set([
    ...records,
    {
      gid,
      lane,
      firstSeenAt: now,
      lastAttemptAt: now,
      attempts: 0,
      status: 'briefed',
      buildDispatchedAt: now
    }
  ])
}

export function isDead(gid: string): boolean {
  return findRecord(gid)?.status === 'dead'
}

export function listDispatchRecords(): AsanaDispatchRecord[] {
  return load().map(cloneRecord)
}

export function pruneOld(now = Date.now()): AsanaDispatchRecord[] {
  const cutoff = now - RETENTION_MS
  persist(load().filter((record) => record.firstSeenAt >= cutoff))
  return listDispatchRecords()
}
