import { createHash } from 'node:crypto'
import { mkdirSync, realpathSync, chmodSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ExecutionIdentity } from './registry'
import { WorkerInstanceLock } from './instance-lock'

export function reserveExecution(
  coordinationPath: string,
  identity: ExecutionIdentity,
  bootId: string,
  recoverOwner?: (prior: { pid: number; processStart: string | null; bootId: string }) => boolean
) {
  mkdirSync(coordinationPath, { recursive: true, mode: 0o700 })
  chmodSync(coordinationPath, 0o700)
  const canonicalCoordination = realpathSync(coordinationPath)
  const coordinationStat = statSync(canonicalCoordination)
  if ((coordinationStat.mode & 0o077) !== 0 || !coordinationStat.isDirectory()) {
    throw new Error(
      'Shared worker coordination directory must be canonical, private and a directory.'
    )
  }
  const keys = [
    `worktree:${identity.worktree.dev}:${identity.worktree.ino}`,
    ...(identity.profileHome
      ? [`profile-home:${identity.profileHome.dev}:${identity.profileHome.ino}`]
      : [])
  ]
  const locks = [...new Set(keys)]
    .map((key) => {
      const hash = createHash('sha256').update(key).digest('hex')
      return new WorkerInstanceLock(join(canonicalCoordination, `execution-${hash}`))
    })
    .sort((a, b) => a.path.localeCompare(b.path))
  const acquired: WorkerInstanceLock[] = []
  try {
    for (const lock of locks) {
      try {
        lock.acquire(bootId)
      } catch (error) {
        if (!recoverOwner) {
          throw error
        }
        lock.recover(bootId, recoverOwner)
      }
      acquired.push(lock)
    }
  } catch (error) {
    for (const lock of acquired) {
      lock.release()
    }
    throw error
  }
  return {
    release() {
      for (const lock of acquired) {
        lock.release()
      }
    }
  }
}
