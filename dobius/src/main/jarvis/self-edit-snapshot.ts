import { createHash } from 'node:crypto'
import { closeSync, constants, openSync, readFileSync } from 'node:fs'

/** The exact bytes of a file at one moment, or proof that it did not exist. */
export type FileSnapshot = { exists: false } | { exists: true; bytes: Buffer }

export function bytesDigest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Digest of a snapshot; null stands for "no file here". */
export function snapshotDigest(snapshot: FileSnapshot): string | null {
  return snapshot.exists ? bytesDigest(snapshot.bytes) : null
}

/**
 * Reads the raw bytes without following a symlink at the leaf.
 *
 * Why raw bytes, not a utf-8 string: the digest must change whenever the file
 * does, and decoding folds invalid byte sequences together.
 */
export function readSnapshot(path: string): FileSnapshot {
  const { O_RDONLY, O_NOFOLLOW } = constants
  let fd: number
  try {
    fd = openSync(path, O_RDONLY | (O_NOFOLLOW ?? 0))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { exists: false }
    }
    throw error
  }
  try {
    return { exists: true, bytes: readFileSync(fd) }
  } finally {
    closeSync(fd)
  }
}
