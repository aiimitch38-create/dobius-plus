import path from 'node:path'
import type { AsanaLane } from '../../shared/asana'
import { parseEveryEntry, SafeJsonFile } from '../storage/safe-json-file'
import { claimStamp, isInterruptedClaim } from './asana-dispatch-claim-owner'
import { getUserDataRoot } from '../storage/user-data-root'

const FILE_NAME = 'asana-dispatch-ledger.json'
const MAX_ATTEMPTS = 2
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export { CLAIM_STALE_MS } from './asana-dispatch-claim-owner'

export type AsanaDispatchRecord = {
  gid: string
  lane: AsanaLane
  firstSeenAt: number
  lastAttemptAt: number
  attempts: number
  status: 'claimed' | 'briefed' | 'failed' | 'dead'
  /** Set once a build worktree was dispatched (or its outcome is unknown) for this task. */
  buildDispatchedAt?: number
  /** Process session that holds a 'claimed' record. */
  claimOwner?: string
  /** Pid of that process; a dead pid means the claim was interrupted. */
  claimPid?: number
  /** When the claim was taken; bounds how long a foreign live claim is trusted. */
  claimedAt?: number
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
  const {
    firstSeenAt,
    lastAttemptAt,
    attempts,
    buildDispatchedAt,
    claimOwner,
    claimPid,
    claimedAt
  } = record
  if (
    !gid ||
    !lane ||
    !status ||
    !isFiniteNumber(firstSeenAt) ||
    !isFiniteNumber(lastAttemptAt) ||
    !isFiniteNumber(attempts) ||
    attempts < 0 ||
    (buildDispatchedAt !== undefined && !isFiniteNumber(buildDispatchedAt)) ||
    (claimOwner !== undefined && typeof claimOwner !== 'string') ||
    (claimPid !== undefined && (!Number.isInteger(claimPid) || (claimPid as number) <= 0)) ||
    (claimedAt !== undefined && !isFiniteNumber(claimedAt))
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
    ...(buildDispatchedAt === undefined ? {} : { buildDispatchedAt }),
    ...(claimOwner === undefined ? {} : { claimOwner }),
    ...(claimPid === undefined ? {} : { claimPid: claimPid as number }),
    ...(claimedAt === undefined ? {} : { claimedAt })
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

// Why: another instance may have written the ledger since this process cached
// it. Each public entry point re-reads it once (one small file); callers then
// work on that one array. There is no cross-process lock, so two instances
// writing in the same instant can still lose one write (known multi-instance limit).
function loadFresh(): AsanaDispatchRecord[] {
  file.invalidate()
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

function isHandled(record: AsanaDispatchRecord | undefined): boolean {
  return record?.status === 'claimed' || record?.status === 'briefed' || record?.status === 'dead'
}

export function hasBeenClaimed(gid: string): boolean {
  loadFresh()
  return isHandled(findRecord(gid))
}

export function claimTask(gid: string, lane: AsanaLane): AsanaDispatchRecord | null {
  const records = loadFresh()
  // Why: an unreadable ledger may hold this task's claim; re-dispatching would start a duplicate paid run.
  if (file.getStatus().status === 'unreadable') {
    return null
  }
  const existing = records.find((record) => record.gid === gid)
  // Why: a task whose build was already dispatched is done-for-dispatch; a
  // retried triage must not launch a second worktree + terminal agent.
  if (isHandled(existing) || existing?.buildDispatchedAt !== undefined) {
    return null
  }
  const now = Date.now()
  if (existing) {
    // Why: failed records are the only retryable state; reclaiming preserves
    // the original edge timestamp while reserving this retry attempt.
    existing.status = 'claimed'
    existing.lane = lane
    existing.lastAttemptAt = now
    Object.assign(existing, claimStamp(now))
    persist(records)
    return cloneRecord(existing)
  }
  const record: AsanaDispatchRecord = {
    gid,
    lane,
    firstSeenAt: now,
    lastAttemptAt: now,
    attempts: 0,
    status: 'claimed',
    ...claimStamp(now)
  }
  persist([...records, record])
  return cloneRecord(record)
}

export function recordBriefed(gid: string): AsanaDispatchRecord | null {
  loadFresh()
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
  loadFresh()
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
  const records = loadFresh()
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

/**
 * A 'claimed' record whose owning process is gone (crash or quit mid-triage),
 * or that a live foreign process has held past CLAIM_STALE_MS, was
 * interrupted: nothing is still working on it. Each counts as one failed attempt, so a retry is bounded and a task that
 * keeps killing the app dead-letters instead of looping. A recorded build
 * still blocks any second dispatch. Returns the reconciled records.
 */
export function reconcileInterruptedClaims(): AsanaDispatchRecord[] {
  const records = loadFresh()
  if (file.getStatus().status === 'unreadable') {
    return []
  }
  const now = Date.now()
  const interrupted = records.filter((record) => isInterruptedClaim(record, now))
  if (interrupted.length === 0) {
    return []
  }
  for (const record of interrupted) {
    record.attempts += 1
    record.lastAttemptAt = now
    record.status = record.attempts >= MAX_ATTEMPTS ? 'dead' : 'failed'
  }
  persist(records)
  return interrupted.map(cloneRecord)
}

/** Fails closed: an unreadable ledger may already record this task's build. */
export function mayDispatchBuild(gid: string): boolean {
  loadFresh()
  const record = findRecord(gid)
  // getStatus reflects the read findRecord just did.
  if (file.getStatus().status === 'unreadable') {
    return false
  }
  return record?.buildDispatchedAt === undefined
}

export function recordBuildDispatched(gid: string, lane: AsanaLane = 'build'): boolean {
  return markBuildDispatched(gid, lane).saved
}

/** `created` is true when the mark had to add the task's record (no claim existed). */
export function markBuildDispatched(
  gid: string,
  lane: AsanaLane = 'build'
): { saved: boolean; created: boolean } {
  const records = loadFresh()
  const now = Date.now()
  const record = records.find((entry) => entry.gid === gid)
  if (record) {
    record.buildDispatchedAt = now
    return { saved: file.set(records), created: false }
  }
  const saved = file.set([
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
  return { saved, created: true }
}

/**
 * Undoes a pre-dispatch mark after the dispatcher definitely failed to start a
 * build. A record the mark itself created is removed, not left as a 'briefed'
 * record that would block the task with nothing to re-queue.
 */
export function clearBuildDispatched(gid: string, createdByMark = false): boolean {
  const records = loadFresh()
  const record = records.find((entry) => entry.gid === gid)
  if (!record || record.buildDispatchedAt === undefined) {
    return true
  }
  if (createdByMark) {
    return file.set(records.filter((entry) => entry !== record))
  }
  delete record.buildDispatchedAt
  return file.set(records)
}

/** Tasks Auto Mode will never pick up again on its own: dead-lettered or already built. */
export function listBlockedTaskGids(): string[] {
  const records = loadFresh()
  if (file.getStatus().status === 'unreadable') {
    return []
  }
  return records
    .filter((record) => record.status === 'dead' || record.buildDispatchedAt !== undefined)
    .map((record) => record.gid)
}

export type RequeueResult = { ok: true } | { ok: false; error: string }

/**
 * Human-only reset (Tasks panel): forgets the task so the next Auto Mode poll
 * triages it again, which may dispatch a new build.
 */
export function requeueTask(gid: string): RequeueResult {
  const records = loadFresh()
  if (file.getStatus().status === 'unreadable') {
    return { ok: false, error: 'The Asana dispatch ledger is unreadable; fix or remove it first.' }
  }
  const record = records.find((entry) => entry.gid === gid)
  if (!record) {
    return { ok: true }
  }
  if (record.status === 'claimed') {
    return { ok: false, error: 'This task is being triaged right now; try again when it finishes.' }
  }
  if (!file.set(records.filter((entry) => entry !== record))) {
    return { ok: false, error: 'Could not save the Asana dispatch ledger.' }
  }
  return { ok: true }
}

export function isDead(gid: string): boolean {
  loadFresh()
  return findRecord(gid)?.status === 'dead'
}

export function listDispatchRecords(): AsanaDispatchRecord[] {
  return loadFresh().map(cloneRecord)
}

// Why: retention only forgets transient outcomes. Dead letters and dispatched
// builds stay until a human re-queues them, and a live claim is never dropped
// mid-run (that would let the next poll claim the task a second time).
function isRetainedForever(record: AsanaDispatchRecord): boolean {
  return (
    record.status === 'dead' ||
    record.status === 'claimed' ||
    record.buildDispatchedAt !== undefined
  )
}

export function pruneOld(now = Date.now()): AsanaDispatchRecord[] {
  const cutoff = now - RETENTION_MS
  persist(loadFresh().filter((record) => isRetainedForever(record) || record.firstSeenAt >= cutoff))
  return listDispatchRecords()
}
