import type { ChildProcess } from 'node:child_process'
import type { QueuePort, WorkerCaps } from '../../../shared/workstation-worker'
import type { AttemptJournal, AttemptRecord } from './journal'
import { collectArtifactEvidence } from './artifact-evidence'
import { collectSourceChangeEvidence } from './source-change-evidence'
import { renewOwnedLease } from './lease-renewal'
import { delay, hashText, terminateOwnedAttempt } from './process-identity'

const TAIL_BYTES = 64 * 1024
const HEARTBEAT_MS = 15_000
const HEARTBEAT_DRAIN_MS = 1_000
const CLOSE_DRAIN_MS = 500

export async function observeAttempt(args: {
  child: ChildProcess
  closePromise: Promise<{ code: number | null }>
  record: AttemptRecord
  caps: WorkerCaps
  queue: QueuePort
  journal: AttemptJournal
  now: () => number
  heartbeatMs?: number
  captureDescendants: () => void
  artifactPaths: readonly string[]
}) {
  const { child, record, caps, queue, journal } = args
  let overflow = false
  let heartbeatError = false
  let heartbeatActive = true
  let heartbeatPending: Promise<void> | null = null
  let heartbeatTimer: ReturnType<typeof setTimeout> | undefined
  let closeResult: { code: number | null } | undefined
  const { closePromise } = args
  void closePromise.then((result) => {
    closeResult = result
  })

  const append = (chunk: Buffer) => {
    if (record.phase !== 'running' || overflow) {
      return
    }
    record.outputBytes = Math.min(caps.outputBytes + 1, record.outputBytes + chunk.length)
    record.logCursor += 1
    record.outputTail = Buffer.concat([Buffer.from(record.outputTail, 'base64'), chunk])
      .subarray(-TAIL_BYTES)
      .toString('base64')
    if (record.outputBytes > caps.outputBytes) {
      overflow = true
      child.stdout?.pause()
      child.stderr?.pause()
    }
    journal.writeIfCurrent(record, record.lease.token)
  }
  child.stdout?.on('data', append)
  child.stderr?.on('data', append)
  const descendantScan = setInterval(() => {
    if (record.phase !== 'running') {
      return
    }
    args.captureDescendants()
    journal.writeIfCurrent(record, record.lease.token)
  }, 100)

  const scheduleHeartbeat = () => {
    if (!heartbeatActive) {
      return
    }
    heartbeatTimer = setTimeout(() => {
      if (!heartbeatActive || heartbeatPending) {
        return
      }
      const previousLease = record.lease
      heartbeatPending = (async () => {
        try {
          const next = await renewOwnedLease({
            queue,
            lease: previousLease,
            progress: { outputBytes: record.outputBytes, logCursor: record.logCursor },
            now: args.now
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
            current.lease.token !== previousLease.token
          ) {
            heartbeatActive = false
            return
          }
          record.lease = next
          record.leaseReceipt.expiresAt = next.expiresAt
          if (!journal.writeIfCurrent(record, previousLease.token)) {
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

  const makeAmbiguousIfOwned = () => {
    const current = journal.read()
    if (
      current &&
      current.attemptId === record.attemptId &&
      current.workerId === record.workerId &&
      current.incarnation === record.incarnation &&
      current.phase === 'running'
    ) {
      record.phase = 'ambiguous'
      journal.writeIfCurrent(record, current.lease.token)
    }
  }

  let stopReason: 'wall-time' | 'output-cap' | 'heartbeat' | null = null
  const deadline = record.startedAt + caps.wallTimeMs
  try {
    while (!closeResult) {
      const current = journal.read()
      if (
        !current ||
        current.attemptId !== record.attemptId ||
        current.incarnation !== record.incarnation ||
        current.phase !== 'running'
      ) {
        await fenceHeartbeat()
        return
      }
      if (heartbeatError) {
        stopReason = 'heartbeat'
      } else if (overflow) {
        stopReason = 'output-cap'
      } else if (args.now() >= deadline) {
        stopReason = 'wall-time'
      }
      if (stopReason) {
        const cleanup = await terminateOwnedAttempt(record)
        args.captureDescendants()
        clearInterval(descendantScan)
        const drained = await fenceHeartbeat()
        if (!cleanup || !drained || heartbeatError) {
          makeAmbiguousIfOwned()
          return
        }
        const boundedClose = await Promise.race([
          closePromise.then((value) => ({ closed: true as const, value })),
          delay(CLOSE_DRAIN_MS).then(() => ({ closed: false as const }))
        ])
        if (!boundedClose.closed) {
          makeAmbiguousIfOwned()
          return
        }
        closeResult = boundedClose.value
        break
      }
      await delay(25)
    }
  } finally {
    clearInterval(descendantScan)
    if (heartbeatActive) {
      await fenceHeartbeat()
    }
  }

  const drained = await fenceHeartbeat()
  if (!drained || heartbeatError) {
    makeAmbiguousIfOwned()
    return
  }
  const cleanup = await terminateOwnedAttempt(record, 100, 1200)
  if (!cleanup) {
    makeAmbiguousIfOwned()
    return
  }
  const current = journal.read()
  if (
    !current ||
    current.attemptId !== record.attemptId ||
    current.incarnation !== record.incarnation ||
    current.phase !== 'running'
  ) {
    return
  }

  record.exitCode = closeResult?.code ?? null
  let artifactEvidence: string[] = []
  let artifactError = false
  try {
    artifactEvidence = collectArtifactEvidence(
      record.worktreePath,
      args.artifactPaths,
      caps.artifactBytes
    )
  } catch {
    artifactError = true
  }
  let sourceChangeEvidence: string[] = []
  let sourceEvidenceError = false
  try {
    sourceChangeEvidence = collectSourceChangeEvidence(record.worktreePath)
  } catch {
    sourceEvidenceError = true
  }
  const succeeded =
    !stopReason &&
    !overflow &&
    !heartbeatError &&
    !artifactError &&
    !sourceEvidenceError &&
    closeResult?.code === 0
  try {
    await queue.settle(record.lease, {
      succeeded,
      exitCode: record.exitCode,
      evidence: [
        `revision:${record.revision}`,
        `output_bytes:${record.outputBytes}`,
        `log_cursor:${record.logCursor}`,
        `log_tail_sha256:${hashText(Buffer.from(record.outputTail, 'base64'))}`,
        'cleanup:process-group-empty',
        ...artifactEvidence,
        ...sourceChangeEvidence,
        ...(sourceEvidenceError ? ['source_changes:unavailable-or-over-cap'] : []),
        ...(artifactError ? ['artifact_evidence:invalid-or-over-cap'] : []),
        ...(stopReason ? [`stop_reason:${stopReason}`] : [])
      ]
    })
    record.phase = 'settled'
    journal.writeIfCurrent(record, record.lease.token)
  } catch {
    makeAmbiguousIfOwned()
  }
}
