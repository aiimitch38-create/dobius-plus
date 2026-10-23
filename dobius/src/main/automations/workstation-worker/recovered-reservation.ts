import { statSync } from 'node:fs'
import type { AttemptRecord } from './journal'
import type { WorkerOptions } from './worker'
import { reserveExecution } from './execution-reservation'
import { processStart } from './process-identity'
import type { AttemptJournal } from './journal'
import type { WorkerInstanceLock } from './instance-lock'

export function reserveRecoveredExecution(
  options: Pick<WorkerOptions, 'coordinationPath' | 'registry'>,
  record: AttemptRecord,
  bootId: string
) {
  const rootStat = statSync(record.root)
  const worktreeStat = statSync(record.worktreePath)
  const profile = options.registry.profiles.find((entry) => entry.id === record.profileId)
  const profileStat = profile ? statSync(profile.home) : null
  return reserveExecution(
    options.coordinationPath,
    {
      root: { dev: String(rootStat.dev), ino: String(rootStat.ino) },
      worktree: { dev: String(worktreeStat.dev), ino: String(worktreeStat.ino) },
      ...(profileStat
        ? { profileHome: { dev: String(profileStat.dev), ino: String(profileStat.ino) } }
        : {})
    },
    bootId,
    (prior) => prior.pid !== process.pid || prior.processStart !== processStart(process.pid)
  )
}

export function isAttemptSettled(journal: AttemptJournal) {
  try {
    const record = journal.read()
    return !record || record.phase === 'settled'
  } catch {
    return false
  }
}

export function acquireRecoveredSupervisor(lock: WorkerInstanceLock, bootId: string) {
  try {
    lock.acquire(bootId)
  } catch {
    lock.recover(
      bootId,
      (prior) => prior.pid !== process.pid || prior.processStart !== processStart(process.pid)
    )
  }
}
