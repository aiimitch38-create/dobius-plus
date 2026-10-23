import type { AttemptRecord, AttemptJournal } from './journal'
import type { WorkerInstanceLock } from './instance-lock'

export function manageRecoveredWatcher(
  watcher: Promise<void>,
  args: {
    record: AttemptRecord
    journal: AttemptJournal
    lock: WorkerInstanceLock
    releaseReservationIfSettled: () => void
    onFinished: () => void
  }
) {
  const recordFailure = (error: unknown) => {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 512)
    try {
      const current = args.journal.read()
      if (
        current?.attemptId === args.record.attemptId &&
        current.incarnation === args.record.incarnation
      ) {
        const updated = { ...current, recoveryError: message }
        if (current.phase === 'running') {
          updated.phase = 'ambiguous'
        }
        args.journal.writeIfCurrent(updated, current.lease.token, current.phase)
      }
    } catch {
      // Keep the failure observable and leave reservations fenced if the journal cannot be written.
    }
  }
  return watcher
    .catch(recordFailure)
    .then(() => {
      try {
        args.releaseReservationIfSettled()
        args.lock.release()
      } catch (error) {
        recordFailure(error)
      }
    })
    .finally(args.onFinished)
}
