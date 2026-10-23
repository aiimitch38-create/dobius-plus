import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  rmdirSync
} from 'node:fs'
import { dirname, isAbsolute, parse, resolve } from 'node:path'

export type LayaJournalVerification = {
  records: number
  lastHash: string | null
  decisionIds: string[]
}

type Envelope<RecordType> = {
  schemaVersion: 1
  previousHash: string | null
  record: RecordType
  hash: string
}

export function assertPrivateDirectory(directory: string): void {
  if (!isAbsolute(directory)) {
    throw new Error('Advisory journal directory must be absolute.')
  }
  let current = resolve(directory)
  while (true) {
    const info = lstatSync(current)
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error('Advisory journal directory is untrusted.')
    }
    if (current === parse(current).root) {
      break
    }
    const parent = dirname(current)
    if (parent === current || parent.length >= current.length) {
      throw new Error('Advisory journal directory ancestry did not progress.')
    }
    current = parent
  }
  const info = lstatSync(directory)
  if (process.getuid && (info.uid !== process.getuid() || (info.mode & 0o077) !== 0)) {
    throw new Error('Advisory journal directory must be private to this user.')
  }
}

export function verifyLockedJournal<
  RecordType extends { kind: 'decision' | 'outcome'; decisionId: string }
>(
  filePath: string,
  maxJournalBytes: number,
  maxRecordBytes: number,
  parseEnvelope: (value: unknown) => Envelope<RecordType>,
  hash: (value: unknown) => string
): LayaJournalVerification {
  const directory = dirname(filePath)
  try {
    assertPrivateDirectory(directory)
    const pathInfo = lstatSync(filePath)
    if (pathInfo.isSymbolicLink() || !pathInfo.isFile() || pathInfo.size > maxJournalBytes) {
      throw new Error('Advisory journal is invalid or exceeds its size limit.')
    }
    const descriptor = openSync(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    let text: string
    try {
      const info = fstatSync(descriptor)
      if (
        !info.isFile() ||
        info.nlink !== 1 ||
        info.dev !== pathInfo.dev ||
        info.ino !== pathInfo.ino
      ) {
        throw new Error('Advisory journal changed while opening.')
      }
      if (process.getuid && (info.uid !== process.getuid() || (info.mode & 0o077) !== 0)) {
        throw new Error('Advisory journal file must be private to this user.')
      }
      const data = Buffer.alloc(info.size)
      let offset = 0
      while (offset < data.length) {
        const count = readSync(descriptor, data, offset, data.length - offset, null)
        if (count === 0) {
          throw new Error('Advisory journal was truncated while reading.')
        }
        offset += count
      }
      text = data.toString('utf8')
    } finally {
      closeSync(descriptor)
    }
    let previousHash: string | null = null
    let records = 0
    const decisionIds = new Set<string>()
    for (const line of text.split('\n').filter(Boolean)) {
      if (Buffer.byteLength(line) > maxRecordBytes) {
        throw new Error('Advisory journal row exceeds its size limit.')
      }
      const envelope = parseEnvelope(JSON.parse(line))
      const body = {
        schemaVersion: envelope.schemaVersion,
        previousHash: envelope.previousHash,
        record: envelope.record
      }
      if (envelope.previousHash !== previousHash || envelope.hash !== hash(body)) {
        throw new Error('Advisory journal hash chain is invalid.')
      }
      if (envelope.record.kind === 'outcome') {
        if (!decisionIds.has(envelope.record.decisionId)) {
          throw new Error('Advisory outcome has no decision record.')
        }
      } else {
        decisionIds.add(envelope.record.decisionId)
      }
      previousHash = envelope.hash
      records += 1
    }
    return { records, lastHash: previousHash, decisionIds: [...decisionIds] }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { records: 0, lastHash: null, decisionIds: [] }
    }
    throw error
  }
}

/** Atomic sibling-directory lock; unknown locks are never guessed stale or removed. */
export class LayaAdvisoryJournalLock {
  static acquire(journalPath: string): () => void {
    if (!isAbsolute(journalPath)) {
      throw new Error('Advisory journal lock path must be absolute.')
    }
    const lockPath = `${journalPath}.lock`
    mkdirSync(lockPath, { mode: 0o700 })
    const acquired = lstatSync(lockPath)
    if (acquired.isSymbolicLink() || !acquired.isDirectory()) {
      throw new Error('Advisory journal lock is invalid.')
    }
    if (process.getuid && (acquired.uid !== process.getuid() || (acquired.mode & 0o077) !== 0)) {
      throw new Error('Advisory journal lock must be private to this user.')
    }
    return () => {
      const current = lstatSync(lockPath)
      if (
        current.isSymbolicLink() ||
        !current.isDirectory() ||
        current.dev !== acquired.dev ||
        current.ino !== acquired.ino
      ) {
        throw new Error('Advisory journal lock ownership changed; preserving unknown lock.')
      }
      rmdirSync(lockPath)
    }
  }
}
