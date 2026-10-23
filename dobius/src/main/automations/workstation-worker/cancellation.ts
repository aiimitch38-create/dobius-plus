import {
  WorkerLeaseReceipt,
  type QueuePort,
  type StopReceipt
} from '../../../shared/workstation-worker'
import type { AttemptJournal } from './journal'
import type { WorkerInstanceLock } from './instance-lock'
import {
  captureOwnedDescendants,
  delay,
  groupExists,
  processGroup,
  processIdentityExists,
  processStart,
  signalOwnedGroup,
  signalOwnedProcess
} from './process-identity'

export async function cancelAttempt(args: {
  leaseInput: unknown
  graceMs: number
  journal: AttemptJournal
  queue: QueuePort
  bootId: string
  now: () => number
}): Promise<StopReceipt> {
  const { leaseInput, graceMs, journal, queue, bootId, now } = args
  const lease = WorkerLeaseReceipt.parse(leaseInput)
  const record = journal.read()
  if (
    !record ||
    record.attemptId !== lease.attemptId ||
    record.workerId !== lease.workerId ||
    record.lease.token !== lease.token
  ) {
    throw new Error('Cancellation lease does not own the durable attempt.')
  }
  if (record.phase === 'settled') {
    throw new Error('Attempt is already settled.')
  }
  const currentStart = record.pid ? processStart(record.pid) : null
  const currentGroup = record.pid ? processGroup(record.pid) : null
  if (
    !record.pid ||
    !record.processStart ||
    !record.processGroupId ||
    currentStart !== record.processStart ||
    currentGroup !== record.processGroupId ||
    record.bootId !== bootId ||
    !groupExists(record.processGroupId)
  ) {
    record.phase = 'ambiguous'
    journal.write(record)
    throw new Error(
      'Process identity is unknown; refusing destructive signal and retaining reservation.'
    )
  }
  record.phase = 'stopping'
  captureOwnedDescendants(record)
  journal.write(record)
  if (!signalOwnedGroup(record, 'SIGTERM')) {
    record.phase = 'ambiguous'
    journal.write(record)
    throw new Error('Process group ownership changed; reservation remains held.')
  }
  for (const child of record.ownedDescendants) {
    signalOwnedProcess(child, 'SIGTERM')
  }
  await delay(graceMs)
  if (groupExists(record.processGroupId)) {
    if (!signalOwnedGroup(record, 'SIGKILL')) {
      record.phase = 'ambiguous'
      journal.write(record)
      throw new Error('Process group ownership changed; reservation remains held.')
    }
  }
  for (const child of record.ownedDescendants) {
    signalOwnedProcess(child, 'SIGKILL')
  }
  const deadline = Date.now() + 3000
  while (
    (groupExists(record.processGroupId) || record.ownedDescendants.some(processIdentityExists)) &&
    Date.now() < deadline
  ) {
    await delay(50)
  }
  if (groupExists(record.processGroupId) || record.ownedDescendants.some(processIdentityExists)) {
    throw new Error('Owned process group or observed descendant remains; reservation stays held.')
  }
  const receipt: StopReceipt = {
    attemptId: record.attemptId,
    workerId: record.workerId,
    processGroupId: record.processGroupId,
    observedAt: now(),
    descendantsAbsent: true,
    containment: 'posix-process-group'
  }
  try {
    await queue.acknowledgeStopped(lease, receipt)
    record.phase = 'settled'
    journal.write(record)
  } catch (error) {
    record.phase = 'ambiguous'
    journal.write(record)
    throw error
  }
  return receipt
}

export async function cancelWithSupervisorLock(
  args: Parameters<typeof cancelAttempt>[0] & {
    lock: WorkerInstanceLock
    afterSettled: () => void
  }
) {
  const borrowed = args.lock.isHeld
  if (!borrowed) {
    args.lock.acquire(args.bootId)
  }
  try {
    const receipt = await cancelAttempt(args)
    args.afterSettled()
    return receipt
  } finally {
    if (!borrowed) {
      args.lock.release()
    }
  }
}

export function cancelForWorker(
  leaseInput: unknown,
  graceMs: number,
  context: Omit<Parameters<typeof cancelWithSupervisorLock>[0], 'leaseInput' | 'graceMs'>
) {
  return cancelWithSupervisorLock({ ...context, leaseInput, graceMs })
}
