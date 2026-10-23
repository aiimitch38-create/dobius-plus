import { createHash } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync
} from 'node:fs'
import type { BigIntStats } from 'node:fs'
import { dirname, join, parse } from 'node:path'
import {
  CloudWorkerConfig,
  type CloudWorkerConfig as ParsedConfig
} from './cloud-worker-config-schema'

export const MAX_WORKER_CONFIG_BYTES = 256 * 1024

export type WorkerConfigGeneration = {
  config: ParsedConfig
  sha256: string
  fileIdentity: string
}

/** Reads a service-owned workers.json without following links, blocking on special files, or accepting swaps. */
export function readPrivateWorkerConfig(baseDirectory: string): WorkerConfigGeneration {
  if (!baseDirectory || realpathSync(baseDirectory) !== baseDirectory) {
    throw new Error('Worker configuration directory is not canonical.')
  }
  assertNoLinkedDirectories(baseDirectory)
  const baseStat = lstatSync(baseDirectory)
  if (
    (baseStat.mode & 0o077) !== 0 ||
    (baseStat.mode & 0o7000) !== 0 ||
    (typeof process.getuid === 'function' && baseStat.uid !== process.getuid())
  ) {
    throw new Error('Worker configuration directory is not private to the service account.')
  }
  const file = join(baseDirectory, 'workers.json')
  const pathBefore = lstatSync(file, { bigint: true })
  assertPrivateRegularFile(pathBefore)
  const noFollow = constants.O_NOFOLLOW
  if (!noFollow) {
    throw new Error('Worker configuration requires no-follow file opens.')
  }
  const descriptor = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK | noFollow)
  try {
    const opened = fstatSync(descriptor, { bigint: true })
    assertPrivateRegularFile(opened)
    if (!sameStat(pathBefore, opened) || opened.size > BigInt(MAX_WORKER_CONFIG_BYTES)) {
      throw new Error('Worker configuration identity or size is invalid.')
    }
    const bytes = Buffer.alloc(Number(opened.size) + 1)
    let offset = 0
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset)
      if (count === 0) {
        break
      }
      offset += count
    }
    if (offset !== Number(opened.size)) {
      throw new Error('Worker configuration changed while being read.')
    }
    const after = fstatSync(descriptor, { bigint: true })
    const pathAfter = lstatSync(file, { bigint: true })
    if (!sameStat(opened, after) || !sameStat(after, pathAfter)) {
      throw new Error('Worker configuration changed while being read.')
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, offset))
    const config = CloudWorkerConfig.parse(JSON.parse(text))
    return {
      config,
      sha256: createHash('sha256').update(bytes.subarray(0, offset)).digest('hex'),
      fileIdentity: statVersion(after)
    }
  } finally {
    closeSync(descriptor)
  }
}

function assertNoLinkedDirectories(directory: string) {
  let current = directory
  while (true) {
    const stat = lstatSync(current)
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('Worker configuration path contains an untrusted directory.')
    }
    if (current === parse(current).root) {
      return
    }
    current = dirname(current)
  }
}

function assertPrivateRegularFile(stat: BigIntStats) {
  const mode = Number(stat.mode & 0o777n)
  if (
    !stat.isFile() ||
    mode & 0o077 ||
    stat.mode & 0o7000n ||
    (typeof process.getuid === 'function' && stat.uid !== BigInt(process.getuid()))
  ) {
    throw new Error('Worker configuration must be a private regular file owned by the service.')
  }
}

function sameStat(left: BigIntStats, right: BigIntStats) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.uid === right.uid &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  )
}

function statVersion(stat: BigIntStats) {
  return [stat.dev, stat.ino, stat.mode, stat.uid, stat.size, stat.mtimeNs, stat.ctimeNs].join(':')
}
