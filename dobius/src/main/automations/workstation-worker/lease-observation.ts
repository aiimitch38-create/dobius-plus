import { WorkerLeaseReceipt, type WorkerLease } from '../../../shared/workstation-worker'
import type { AttemptJournal } from './journal'

export type WorkerJournalLeaseObservation =
  | { kind: 'fresh' | 'idle' }
  | { kind: 'active'; lease: WorkerLease }
  | { kind: 'unknown' }

/** Private host observation only; tokens must never enter UI/RPC status. */
export function observeJournalLease(
  journal: Pick<AttemptJournal, 'read'>,
  workerId: string
): WorkerJournalLeaseObservation {
  try {
    const record = journal.read()
    if (!record) {
      return { kind: 'fresh' }
    }
    const lease = WorkerLeaseReceipt.parse(record.lease)
    if (
      record.workerId !== workerId ||
      lease.workerId !== workerId ||
      record.attemptId !== lease.attemptId
    ) {
      return { kind: 'unknown' }
    }
    if (record.phase === 'settled') {
      return { kind: 'idle' }
    }
    if (record.phase !== 'running') {
      return { kind: 'unknown' }
    }
    return { kind: 'active', lease }
  } catch {
    return { kind: 'unknown' }
  }
}
