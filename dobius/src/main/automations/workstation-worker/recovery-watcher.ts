import type { QueuePort } from '../../../shared/workstation-worker'
import type { AttemptJournal, AttemptRecord } from './journal'
import { renewOwnedLease } from './lease-renewal'
import {
  delay,
  hasUnresolvedOwnedProcesses,
  processGroup,
  processStart,
  terminateOwnedAttempt
} from './process-identity'

const HEARTBEAT_MS = 15_000
const HEARTBEAT_DRAIN_MS = 1_000

export async function watchRecoveredAttempt(args: {
  record: AttemptRecord
  journal: AttemptJournal
  queue: QueuePort
  now: () => number
  heartbeatMs?: number
}) {
  const { record, journal, queue, now } = args
  let heartbeatActive = true
  let heartbeatPending: Promise<void> | null = null
  let heartbeatTimer: ReturnType<typeof setTimeout> | undefined
  let heartbeatError = false
  const deadline = record.startedAt + record.caps.wallTimeMs

  const scheduleHeartbeat = () => {
    if (!heartbeatActive) {
      return
    }
    heartbeatTimer = setTimeout(() => {
      if (!heartbeatActive || heartbeatPending) {
        return
      }
      const oldLease = record.lease
      heartbeatPending = (async () => {
        try {
          const next = await renewOwnedLease({
            queue,
            lease: oldLease,
            progress: { outputBytes: record.outputBytes, logCursor: record.logCursor },
            now
          })
          if (!heartbeatActive) {
            return
          }
          const current = journal.read()
          if (
            !current ||
            current.attemptId !== record.attemptId ||
            current.workerId !== record.workerId ||
            current.incarnation !== record.incarnation ||
            current.phase !== 'running' ||
            current.lease.token !== oldLease.token
          ) {
            heartbeatActive = false
            return
          }
          record.lease = next
          record.leaseReceipt.expiresAt = next.expiresAt
          if (!journal.writeIfCurrent(record, oldLease.token)) {
            heartbeatActive = false
            heartbeatError = true
          }
        } catch {
          if (heartbeatActive) {
            heartbeatError = true
          }
        } finally {
          heartbeatPending = null
          scheduleHeartbeat()
        }
      })()
    }, args.heartbeatMs ?? HEARTBEAT_MS)
  }
  scheduleHeartbeat()

  const fenceHeartbeat = async () => {
    heartbeatActive = false
    if (heartbeatTimer) {
      clearTimeout(heartbeatTimer)
    }
    const pending = heartbeatPending
    if (!pending) {
      return true
    }
    return Promise.race([pending.then(() => true), delay(HEARTBEAT_DRAIN_MS).then(() => false)])
  }

  const markAmbiguousIfOwned = () => {
    const current = journal.read()
    if (
      current &&
      current.attemptId === record.attemptId &&
      current.incarnation === record.incarnation &&
      current.phase === 'running'
    ) {
      record.phase = 'ambiguous'
      journal.writeIfCurrent(record, current.lease.token)
    }
  }

  while (record.phase === 'running') {
    await delay(100)
    const current = journal.read()
    if (
      !current ||
      current.attemptId !== record.attemptId ||
      current.workerId !== record.workerId ||
      current.incarnation !== record.incarnation ||
      current.phase !== 'running'
    ) {
      await fenceHeartbeat()
      return
    }
    const currentStart = record.pid ? processStart(record.pid) : null
    const currentGroup = record.pid ? processGroup(record.pid) : null
    if (
      !currentStart ||
      !record.processStart ||
      currentStart !== record.processStart ||
      currentGroup === null ||
      currentGroup !== record.processGroupId
    ) {
      await fenceHeartbeat()
      markAmbiguousIfOwned()
      return
    }

    const timedOut = now() >= deadline
    const outputExceeded = record.outputBytes > record.caps.outputBytes
    const processEnded = !hasUnresolvedOwnedProcesses(record)
    if (timedOut || outputExceeded || processEnded || heartbeatError) {
      const cleanup = await terminateOwnedAttempt(record)
      const drained = await fenceHeartbeat()
      if (!cleanup || !drained || heartbeatError) {
        markAmbiguousIfOwned()
        return
      }
      const latest = journal.read()
      if (
        !latest ||
        latest.attemptId !== record.attemptId ||
        latest.incarnation !== record.incarnation ||
        latest.phase !== 'running'
      ) {
        return
      }
      try {
        await queue.settle(record.lease, {
          succeeded: false,
          exitCode: null,
          evidence: [
            `revision:${record.revision}`,
            'restart:process-ended-without-observed-exit',
            timedOut
              ? 'stop_reason:original-wall-time-deadline'
              : outputExceeded
                ? 'stop_reason:recovered-output-cap-already-exceeded'
                : 'stop_reason:recovered-process-ended',
            'cleanup:process-group-and-known-descendants-empty'
          ]
        })
        record.phase = 'settled'
        journal.writeIfCurrent(record, record.lease.token)
      } catch {
        markAmbiguousIfOwned()
      }
      return
    }
  }
  await fenceHeartbeat()
}
