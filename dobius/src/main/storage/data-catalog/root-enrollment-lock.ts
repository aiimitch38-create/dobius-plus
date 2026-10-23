import { closeSync, fstatSync, lstatSync, mkdirSync, openSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'

/** Serialize registry writers across app/server instances without guessing stale-lock ownership. */
export function withRootEnrollmentWrite<T>(filePath: string, write: () => T): T {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 })
  const lockPath = `${filePath}.lock`
  let descriptor: number
  try {
    descriptor = openSync(lockPath, 'wx', 0o600)
  } catch {
    throw new Error('Folder registrations are busy; retry after the other writer finishes')
  }
  const identity = fstatSync(descriptor)
  try {
    return write()
  } finally {
    closeSync(descriptor)
    // Never unlink a replacement lock created by a different writer.
    const current = lstatSync(lockPath, { throwIfNoEntry: false })
    if (current && current.dev === identity.dev && current.ino === identity.ino) {
      unlinkSync(lockPath)
    }
  }
}
