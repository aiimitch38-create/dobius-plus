import { createHmac, randomBytes } from 'node:crypto'
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs'
import { join } from 'node:path'
import { adamProjectDirectory, resolveAdamTarget } from './adam-connection'

const epochKey = randomBytes(32)
const MAX_TOKEN_BYTES = 16 * 1024

/** Main-only opaque fingerprint; capture and compare synchronously around each await. */
export function captureAdamAuthorizationEpoch(): string | null {
  try {
    const target = resolveAdamTarget()
    if (!target.ok) {
      return null
    }
    const digest = createHmac('sha256', epochKey).update(target.endpoint).update('\0')
    const environmentToken = process.env.ADAM_SERVICE_TOKEN?.trim()
    if (environmentToken) {
      if (!validToken(environmentToken)) {
        return null
      }
      return digest.update('environment\0').update(environmentToken).digest('hex')
    }
    if (typeof process.getuid !== 'function' || !constants.O_NOFOLLOW) {
      return null
    }
    const file =
      process.env.ADAM_SERVICE_TOKEN_PATH?.trim() ||
      process.env.DOBIUS_ADAM_TOKEN_PATH?.trim() ||
      join(adamProjectDirectory(), 'service', 'data', 'service-token')
    const before = lstatSync(file, { bigint: true })
    if (!before.isFile() || before.isSymbolicLink()) {
      return null
    }
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const bytes = Buffer.alloc(MAX_TOKEN_BYTES + 1)
    try {
      const info = fstatSync(fd, { bigint: true })
      if (
        !info.isFile() ||
        info.uid !== BigInt(process.getuid()) ||
        (info.mode & 0o077n) !== 0n ||
        info.size > BigInt(MAX_TOKEN_BYTES) ||
        info.dev !== before.dev ||
        info.ino !== before.ino
      ) {
        return null
      }
      let length = 0
      while (length < bytes.length) {
        const count = readSync(fd, bytes, length, bytes.length - length, null)
        if (!count) {
          break
        }
        length += count
      }
      if (length > MAX_TOKEN_BYTES) {
        return null
      }
      const after = fstatSync(fd, { bigint: true })
      const path = lstatSync(file, { bigint: true })
      if (
        after.dev !== info.dev ||
        after.ino !== info.ino ||
        after.size !== info.size ||
        after.mtimeNs !== info.mtimeNs ||
        after.ctimeNs !== info.ctimeNs ||
        path.isSymbolicLink() ||
        path.dev !== info.dev ||
        path.ino !== info.ino
      ) {
        return null
      }
      const token = new TextDecoder('utf-8', { fatal: true })
        .decode(bytes.subarray(0, length))
        .trim()
      if (!validToken(token)) {
        return null
      }
      return digest
        .update('file\0')
        .update(file)
        .update('\0')
        .update(`${info.dev}:${info.ino}:${info.mtimeNs}:${info.ctimeNs}\0`)
        .update(token)
        .digest('hex')
    } finally {
      bytes.fill(0)
      closeSync(fd)
    }
  } catch {
    return null
  }
}

function validToken(token: string): boolean {
  return /^[\x21-\x7e]{1,8192}$/.test(token)
}
