import path from 'node:path'
import { app } from 'electron'
import type { AsanaLane } from '../../shared/asana'
import { SafeJsonFile } from '../storage/safe-json-file'

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
  return path.join(app.getPath('userData'), FILE_NAME)
}

function sanitizeRecord(raw: unknown): AsanaDispatchRecord | null {
  if (typeof raw !== 'object' || raw === null) {
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
  if (!gid || !lane || !status) {
    return null
  }
  const firstSeenAt = typeof record.firstSeenAt === 'number' ? record.firstSeenAt : Date.now()
  const lastAttemptAt =
    typeof record.lastAttemptAt === 'number' ? record.lastAttemptAt : firstSeenAt
  const attempts =
    typeof record.attempts === 'number' && Number.isFinite(record.attempts)
      ? Math.max(0, Math.floor(record.attempts))
      : 0
  const buildDispatchedAt =
    typeof record.buildDispatchedAt === 'number' ? record.buildDispatchedAt : undefined
  return {
    gid,
    lane,
    firstSeenAt,
    lastAttemptAt,
    attempts,
    status,
    ...(buildDispatchedAt === undefined ? {} : { buildDispatchedAt })
  }
}

const file = new SafeJsonFile<AsanaDispatchRecord[]>({
  filePath,
  parse: (raw) =>
    Array.isArray(raw)
      ? raw.flatMap((entry) => {
          const record = sanitizeRecord(entry)
          return record ? [record] : []
        })
      : undefined,
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
