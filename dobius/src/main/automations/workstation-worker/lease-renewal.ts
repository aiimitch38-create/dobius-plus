import {
  WorkerLeaseReceipt,
  type QueuePort,
  type WorkerLease
} from '../../../shared/workstation-worker'

export async function renewOwnedLease(args: {
  queue: QueuePort
  lease: WorkerLease
  progress: { outputBytes: number; logCursor: number }
  now: () => number
}) {
  const next = WorkerLeaseReceipt.parse(await args.queue.heartbeat(args.lease, args.progress))
  if (
    next.attemptId !== args.lease.attemptId ||
    next.workerId !== args.lease.workerId ||
    next.token !== args.lease.token ||
    next.expiresAt <= args.lease.expiresAt ||
    next.expiresAt <= args.now()
  ) {
    throw new Error('Heartbeat receipt does not monotonically renew the owned lease.')
  }
  return next
}
