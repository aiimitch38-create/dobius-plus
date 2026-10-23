import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  LeaseSealer,
  WorkerCaps,
  WorkerJob,
  WorkerLease
} from '../../../shared/workstation-worker'

export type AttemptRecord = {
  schema: 1
  phase: 'launching' | 'running' | 'stopping' | 'settled' | 'ambiguous'
  attemptId: string
  jobId: string
  workerId: string
  incarnation: string
  bootId: string
  lease: WorkerLease
  leaseReceipt: { attemptId: string; workerId: string; expiresAt: number }
  root: string
  worktreePath: string
  revision: string
  profileId: string
  worktreeId: string
  recipeId: string
  caps: WorkerCaps
  pid: number | null
  processStart: string | null
  processGroupId: number | null
  ownedDescendants: { pid: number; processStart: string; processGroupId: number }[]
  startedAt: number
  outputBytes: number
  logCursor: number
  outputTail: string
  recoveryError?: string
  exitCode: number | null
}

export function createAttemptRecord(
  job: WorkerJob,
  lease: WorkerLease,
  root: string,
  worktreePath: string,
  incarnation: string,
  bootId: string,
  now: number
): AttemptRecord {
  return {
    schema: 1,
    phase: 'launching',
    attemptId: job.attemptId,
    jobId: job.id,
    workerId: lease.workerId,
    incarnation,
    bootId,
    lease,
    leaseReceipt: {
      attemptId: lease.attemptId,
      workerId: lease.workerId,
      expiresAt: lease.expiresAt
    },
    root,
    worktreePath,
    revision: job.sourceRevision,
    profileId: job.profileId,
    worktreeId: job.worktreeId,
    recipeId: job.recipeId,
    caps: job.caps,
    pid: null,
    processStart: null,
    processGroupId: null,
    ownedDescendants: [],
    startedAt: now,
    outputBytes: 0,
    logCursor: 0,
    outputTail: '',
    exitCode: null
  }
}

export class AttemptJournal {
  constructor(
    private readonly path: string,
    private readonly sealer: LeaseSealer
  ) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    chmodSync(dirname(path), 0o700)
  }

  read(): AttemptRecord | null {
    try {
      const record = JSON.parse(readFileSync(this.path, 'utf8')) as AttemptRecord
      if (!record.lease.token.startsWith('sealed:v1:')) {
        throw new Error('Attempt journal lease receipt is not sealed.')
      }
      record.lease.token = this.sealer.unseal(record.lease.token)
      return record
    } catch (error) {
      if (error instanceof Error && error.message.includes('sealed')) {
        throw error
      }
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      throw new Error('Attempt journal is corrupt or unreadable; worker remains fenced.')
    }
  }

  write(record: AttemptRecord) {
    const temp = `${this.path}.${randomUUID()}.tmp`
    const persisted = {
      ...record,
      lease: { ...record.lease, token: this.sealer.seal(record.lease.token) }
    }
    writeFileSync(temp, JSON.stringify(persisted), { mode: 0o600, flag: 'wx' })
    chmodSync(temp, 0o600)
    renameSync(temp, this.path)
    chmodSync(this.path, 0o600)
  }

  writeIfCurrent(record: AttemptRecord, expectedLeaseToken: string, phase = 'running') {
    const current = this.read()
    if (
      !current ||
      current.attemptId !== record.attemptId ||
      current.workerId !== record.workerId ||
      current.incarnation !== record.incarnation ||
      current.bootId !== record.bootId ||
      current.phase !== phase ||
      current.lease.token !== expectedLeaseToken
    ) {
      return false
    }
    this.write(record)
    return true
  }
}
