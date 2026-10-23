import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { processStart } from './process-identity'

type LockOwner = {
  lockId: string
  pid: number
  processStart: string | null
  bootId: string
}

export class WorkerInstanceLock {
  private owner: LockOwner | null = null

  constructor(readonly path: string) {}

  acquire(bootId: string) {
    if (this.owner) {
      return
    }
    try {
      mkdirSync(this.path, { mode: 0o700 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
      let prior: LockOwner
      try {
        prior = JSON.parse(readFileSync(join(this.path, 'owner.json'), 'utf8')) as LockOwner
      } catch {
        throw new Error('Worker lock is unreadable; refusing concurrent execution.')
      }
      if (
        prior.bootId === bootId &&
        prior.pid > 0 &&
        prior.processStart === processStart(prior.pid)
      ) {
        throw new Error('Another supervisor owns this worker or worktree lock.')
      }
      // A stale directory may have changed since inspection; never unlink it automatically.
      throw new Error(
        'Worker lock owner is stale or from another boot; explicit reconciliation required.'
      )
    }
    chmodSync(this.path, 0o700)
    const owner: LockOwner = {
      lockId: randomUUID(),
      pid: process.pid,
      processStart: processStart(process.pid),
      bootId
    }
    try {
      writeFileSync(join(this.path, 'owner.json'), JSON.stringify(owner), {
        flag: 'wx',
        mode: 0o600
      })
    } catch (error) {
      try {
        rmdirSync(this.path)
      } catch {
        // Preserve a directory that another actor may have populated.
      }
      throw error
    }
    this.owner = owner
  }

  get isHeld() {
    return this.owner !== null
  }

  recover(bootId: string, mayAdopt: (prior: LockOwner) => boolean) {
    const guard = `${this.path}.recovery`
    try {
      mkdirSync(guard, { mode: 0o700 })
    } catch {
      throw new Error('Worker lock recovery is already in progress.')
    }
    try {
      const ownerPath = join(this.path, 'owner.json')
      const prior = JSON.parse(readFileSync(ownerPath, 'utf8')) as LockOwner
      if (
        prior.bootId === bootId &&
        prior.pid > 0 &&
        prior.processStart === processStart(prior.pid)
      ) {
        throw new Error('Worker lock owner is still alive.')
      }
      if (!mayAdopt(prior)) {
        throw new Error('Worker lock cannot be safely recovered.')
      }
      const again = JSON.parse(readFileSync(ownerPath, 'utf8')) as LockOwner
      if (again.lockId !== prior.lockId) {
        throw new Error('Worker lock changed during recovery.')
      }
      const owner: LockOwner = {
        lockId: randomUUID(),
        pid: process.pid,
        processStart: processStart(process.pid),
        bootId
      }
      const claimedPath = join(this.path, `claimed-${prior.lockId}.json`)
      renameSync(ownerPath, claimedPath)
      const claimed = JSON.parse(readFileSync(claimedPath, 'utf8')) as LockOwner
      if (claimed.lockId !== prior.lockId) {
        try {
          renameSync(claimedPath, ownerPath)
        } catch {
          /* Keep both identities for manual reconciliation. */
        }
        throw new Error('Worker lock changed during atomic recovery claim.')
      }
      try {
        writeFileSync(ownerPath, JSON.stringify(owner), { flag: 'wx', mode: 0o600 })
        unlinkSync(claimedPath)
      } catch (error) {
        try {
          renameSync(claimedPath, ownerPath)
        } catch {
          /* Preserve evidence if another owner appeared. */
        }
        throw error
      }
      this.owner = owner
    } finally {
      rmdirSync(guard)
    }
  }

  release() {
    const owner = this.owner
    if (!owner) {
      return
    }
    const ownerPath = join(this.path, 'owner.json')
    try {
      const current = JSON.parse(readFileSync(ownerPath, 'utf8')) as LockOwner
      if (current.lockId !== owner.lockId) {
        throw new Error('Worker lock identity changed; refusing to remove another owner’s lock.')
      }
      unlinkSync(ownerPath)
      rmdirSync(this.path)
      this.owner = null
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(
          'Worker lock disappeared before release; refusing to clear its owner state.'
        )
      }
      throw error
    }
  }
}
