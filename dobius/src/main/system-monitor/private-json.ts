import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs'
import { dirname, parse } from 'node:path'

export const MAX_PRIVATE_JSON_BYTES = 2 * 1024 * 1024

export type PrivateJsonFailure = 'missing' | 'invalid' | 'untrusted_file'

export class PrivateJsonError extends Error {
  constructor(readonly reason: PrivateJsonFailure) {
    super(reason)
    this.name = 'PrivateJsonError'
  }
}

function assertPrivateDirectory(directory: string): void {
  let current = directory
  while (true) {
    const info = lstatSync(current)
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new PrivateJsonError('untrusted_file')
    }
    if (current === parse(current).root) {
      return
    }
    current = dirname(current)
  }
}

/** Reads one private regular JSON file without following a swapped symlink or blocking on a FIFO. */
export function readBoundedPrivateJson(filePath: string): unknown {
  const directory = dirname(filePath)
  try {
    assertPrivateDirectory(directory)
    const directoryInfo = lstatSync(directory)
    if (
      process.getuid &&
      (directoryInfo.uid !== process.getuid() || (directoryInfo.mode & 0o077) !== 0)
    ) {
      throw new PrivateJsonError('untrusted_file')
    }

    const pathInfo = lstatSync(filePath)
    if (pathInfo.isSymbolicLink() || !pathInfo.isFile()) {
      throw new PrivateJsonError('untrusted_file')
    }

    const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
    const descriptor = openSync(filePath, flags)
    try {
      const info = fstatSync(descriptor)
      if (
        !info.isFile() ||
        info.dev !== pathInfo.dev ||
        info.ino !== pathInfo.ino ||
        info.size > MAX_PRIVATE_JSON_BYTES
      ) {
        throw new PrivateJsonError('invalid')
      }
      if (process.getuid && (info.uid !== process.getuid() || (info.mode & 0o077) !== 0)) {
        throw new PrivateJsonError('untrusted_file')
      }

      const bytes = Buffer.allocUnsafe(MAX_PRIVATE_JSON_BYTES + 1)
      let length = 0
      while (length < bytes.length) {
        const count = readSync(descriptor, bytes, length, bytes.length - length, null)
        if (count === 0) {
          break
        }
        length += count
      }
      if (length > MAX_PRIVATE_JSON_BYTES) {
        throw new PrivateJsonError('invalid')
      }
      try {
        return JSON.parse(bytes.subarray(0, length).toString('utf8')) as unknown
      } catch {
        throw new PrivateJsonError('invalid')
      }
    } finally {
      closeSync(descriptor)
    }
  } catch (error) {
    if (error instanceof PrivateJsonError) {
      throw error
    }
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      throw new PrivateJsonError('missing')
    }
    if (code === 'ELOOP' || code === 'EACCES' || code === 'EPERM') {
      throw new PrivateJsonError('untrusted_file')
    }
    throw new PrivateJsonError('invalid')
  }
}
