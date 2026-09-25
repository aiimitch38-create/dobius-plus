import { randomUUID } from 'node:crypto'
import { isPidAlive } from '../lib/is-pid-alive'

type ClaimFields = {
  status: string
  claimOwner?: string
  claimPid?: number
  claimedAt?: number
}

// Why: claims carry the id and pid of the process that made them, so a claim
// left 'claimed' by a crashed or quit process is told apart from a live one,
// including one held by another instance sharing this userData (dev runs and
// DOBIUS_BYPASS_SINGLE_INSTANCE_LOCK have no single-instance lock).
const PROCESS_CLAIM_OWNER = randomUUID()
// Why: a foreign claim whose process is still alive is reconciled only after
// this long. A triage run is capped at 15 turns / $0.30 (roughly 30 min worst
// case) plus a dispatch_build wait of up to 10 min; 60 min leaves a margin.
export const CLAIM_STALE_MS = 60 * 60 * 1000

export function claimStamp(now: number): Required<Omit<ClaimFields, 'status'>> {
  return { claimOwner: PROCESS_CLAIM_OWNER, claimPid: process.pid, claimedAt: now }
}

// Mirrors BUILD-026's coordinator-run orphan check (runtime/orchestration/db.ts).
export function isInterruptedClaim(record: ClaimFields, now: number): boolean {
  if (record.status !== 'claimed' || record.claimOwner === PROCESS_CLAIM_OWNER) {
    return false
  }
  const pid = record.claimPid
  // Legacy owner-less claims, and a reused pid of this very process, are dead owners.
  if (pid === undefined || pid === process.pid || !isPidAlive(pid)) {
    return true
  }
  return record.claimedAt === undefined || now - record.claimedAt > CLAIM_STALE_MS
}
