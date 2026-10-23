import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { chmodSync } from 'node:fs'
import { dirname } from 'node:path'
import type { QueuePort, StopReceipt, LeaseSealer } from '../../../shared/workstation-worker'
import { AttemptJournal, createAttemptRecord, type AttemptRecord } from './journal'
import { observeAttempt } from './attempt-observer'
import { WorkerInstanceLock } from './instance-lock'
import { watchRecoveredAttempt } from './recovery-watcher'
import { resolveExecution, type WorkerRegistry } from './registry'
import { authorizeExecution } from './start-authorization'
import { cancelForWorker } from './cancellation'
import {
  acquireRecoveredSupervisor,
  reserveRecoveredExecution,
  isAttemptSettled
} from './recovered-reservation'
import { reserveExecution } from './execution-reservation'
import { manageRecoveredWatcher } from './recovered-lifecycle'
import { observeJournalLease } from './lease-observation'
import { validateWorkerClaim } from './claim-validation'
import {
  captureOwnedDescendants,
  processGroup,
  processStart,
  preflightProcessInspection,
  readBootId,
  safeEnvironment,
  terminateOwnedAttempt,
  terminateGroup
} from './process-identity'

export type WorkerOptions = {
  registry: WorkerRegistry
  statePath: string
  coordinationPath: string
  queue: QueuePort
  now?: () => number
  bootId?: string
  heartbeatMs?: number
  leaseSealer: LeaseSealer
  processInspection?: {
    processStart(pid: number): string | null
    processGroup(pid: number): number | null
  }
}

export class WorkstationWorker {
  private readonly journal: AttemptJournal
  private readonly now: () => number
  private readonly bootId: string
  private readonly incarnation = randomUUID()
  private readonly lock: WorkerInstanceLock
  private reservation: ReturnType<typeof reserveExecution> | null = null
  private busy = false
  private recoveredWatcher: Promise<void> | null = null

  constructor(private readonly options: WorkerOptions) {
    if (process.platform === 'win32') {
      throw new Error('Windows descendant containment is not verified; worker refuses startup.')
    }
    preflightProcessInspection(options.processInspection)
    this.journal = new AttemptJournal(options.statePath, options.leaseSealer)
    this.lock = new WorkerInstanceLock(`${options.statePath}.worker-lock`)
    this.now = options.now ?? Date.now
    this.bootId = options.bootId ?? readBootId()
    chmodSync(dirname(options.statePath), 0o700)
  }
  async runClaim(input: unknown): Promise<void> {
    this.lock.acquire(this.bootId)
    let previous: AttemptRecord | null
    try {
      previous = this.journal.read()
    } catch (error) {
      this.lock.release()
      throw error
    }
    if (this.busy || (previous && previous.phase !== 'settled')) {
      if (!this.busy) {
        this.lock.release()
      }
      throw new Error('Worker already has a durable attempt; reconcile before another claim.')
    }
    this.busy = true
    try {
      const { job, lease } = validateWorkerClaim(input, this.options.registry.workerId, this.now())
      const execution = resolveExecution(this.options.registry, job)
      const caps = job.caps
      this.reservation = reserveExecution(
        this.options.coordinationPath,
        execution.identity,
        this.bootId
      )
      const authorization = await authorizeExecution({
        queue: this.options.queue,
        lease,
        job,
        registry: this.options.registry,
        expectedExecution: execution,
        now: this.now
      })
      const record = createAttemptRecord(
        job,
        lease,
        execution.root,
        execution.worktree,
        this.incarnation,
        this.bootId,
        this.now()
      )
      this.journal.write(record) // Durable launch intent closes the claim-before-spawn crash window.
      let finalExecution
      try {
        finalExecution = authorization.recheck()
      } catch (error) {
        record.phase = 'ambiguous'
        this.journal.write(record)
        throw error
      }
      const child = spawn(finalExecution.recipe.executable, [...finalExecution.argv], {
        cwd: finalExecution.worktree,
        env: safeEnvironment(finalExecution.profileHome),
        detached: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      const closePromise = new Promise<{ code: number | null }>((resolve) => {
        child.once('error', () => resolve({ code: null }))
        child.once('close', (code) => resolve({ code }))
      })
      if (!child.pid) {
        throw new Error('Executor did not return a process identity.')
      }
      record.pid = child.pid
      record.processStart = processStart(child.pid)
      record.processGroupId = processGroup(child.pid)
      if (!record.processStart || record.processGroupId !== child.pid) {
        terminateGroup(child.pid)
        record.phase = 'ambiguous'
        this.journal.write(record)
        throw new Error(
          'Could not verify process start and group identity; attempt remains fenced.'
        )
      }
      record.phase = 'running'
      this.journal.write(record)
      try {
        await this.options.queue.acknowledgeStarted(lease, {
          pid: child.pid,
          processStart: record.processStart,
          processGroupId: record.processGroupId,
          bootId: record.bootId,
          incarnation: record.incarnation
        })
      } catch {
        record.phase = 'ambiguous'
        this.journal.write(record)
        await terminateOwnedAttempt(record)
        return
      }
      await observeAttempt({
        child,
        closePromise,
        record,
        caps,
        queue: this.options.queue,
        journal: this.journal,
        now: this.now,
        heartbeatMs: this.options.heartbeatMs,
        captureDescendants: () => captureOwnedDescendants(record),
        artifactPaths: execution.recipe.artifactPaths ?? []
      })
    } finally {
      this.busy = false
      this.releaseReservationIfSettled()
      this.lock.release()
    }
  }
  async reconcile(): Promise<'idle' | 'running' | 'ambiguous'> {
    if (this.busy) {
      return 'running'
    }
    let record: AttemptRecord | null
    try {
      record = this.journal.read()
    } catch {
      return 'ambiguous'
    }
    if (!record) {
      return 'idle'
    }
    if (record.phase === 'settled') {
      return 'idle'
    }
    if (
      record.phase !== 'running' ||
      record.bootId !== this.bootId ||
      !record.pid ||
      !record.processStart ||
      !record.processGroupId
    ) {
      return 'ambiguous'
    }
    if (
      processStart(record.pid) !== record.processStart ||
      processGroup(record.pid) !== record.processGroupId
    ) {
      return 'ambiguous'
    }
    try {
      acquireRecoveredSupervisor(this.lock, this.bootId)
    } catch {
      return 'ambiguous'
    }
    try {
      const status = await this.options.queue.reconcile(record.lease, {
        pid: record.pid,
        processStart: record.processStart,
        processGroupId: record.processGroupId,
        bootId: record.bootId,
        incarnation: record.incarnation
      })
      if (status === 'owned' || status === 'stopping') {
        this.reservation = reserveRecoveredExecution(this.options, record, this.bootId)
      }
      if (status === 'owned') {
        this.busy = true
        const watcher = watchRecoveredAttempt({
          record,
          journal: this.journal,
          queue: this.options.queue,
          now: this.now,
          heartbeatMs: this.options.heartbeatMs
        })
        this.recoveredWatcher = manageRecoveredWatcher(watcher, {
          record,
          journal: this.journal,
          lock: this.lock,
          releaseReservationIfSettled: () => this.releaseReservationIfSettled(),
          onFinished: () => {
            this.busy = false
            this.recoveredWatcher = null
          }
        })
        return 'running'
      }
      if (status === 'stopping') {
        await this.cancel(record.lease)
        this.releaseReservationIfSettled()
        this.lock.release()
        return 'idle'
      }
    } catch {
      // Queue uncertainty never grants a new launch or destructive signal authority.
    }
    record.phase = 'ambiguous'
    this.journal.writeIfCurrent(record, record.lease.token)
    this.lock.release()
    return 'ambiguous'
  }
  async cancel(leaseInput: unknown, graceMs = 1500): Promise<StopReceipt> {
    return cancelForWorker(leaseInput, graceMs, {
      journal: this.journal,
      queue: this.options.queue,
      bootId: this.bootId,
      now: this.now,
      lock: this.lock,
      afterSettled: this.releaseReservationIfSettled.bind(this)
    })
  }
  async drainRecovery() {
    await this.recoveredWatcher
  }
  observePrivateLease() {
    return observeJournalLease(this.journal, this.options.registry.workerId)
  }
  private releaseReservationIfSettled() {
    if (isAttemptSettled(this.journal)) {
      this.reservation?.release()
      this.reservation = null
    }
  }
}
