import { strict as assert } from 'node:assert'
import { timingSafeEqual } from 'node:crypto'
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readSync,
  unlinkSync,
  writeSync
} from 'node:fs'
import type { Stats } from 'node:fs'

export const LEASE_KEY_BYTES = 32

type KeyWriter = (
  ...args: [fd: number, buffer: Buffer, offset: number, length: number, position: number]
) => number

/** Write, verify, and atomically publish a complete 256-bit key. */
export function writeAndPublishKey(
  temporaryPath: string,
  keyPath: string,
  key: Buffer,
  write: KeyWriter = writeSync
) {
  assert(key.length === LEASE_KEY_BYTES, 'Lease key must contain exactly 256 bits.')
  let fd: number | undefined
  let ownsTemporary = false
  let failure: unknown
  try {
    fd = openSync(
      temporaryPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | noFollowFlag(),
      0o600
    )
    ownsTemporary = true
    fchmodSync(fd, 0o600)
    let offset = 0
    while (offset < LEASE_KEY_BYTES) {
      const written = write(fd, key, offset, LEASE_KEY_BYTES - offset, offset)
      assert(
        Number.isInteger(written) && written > 0 && written <= LEASE_KEY_BYTES - offset,
        'Lease key write made no valid progress; refusing publication.'
      )
      offset += written
    }
    fsyncSync(fd)
    const descriptorStat = fstatSync(fd) as Stats
    const pathStat = lstatSync(temporaryPath) as Stats
    const verified = Buffer.alloc(LEASE_KEY_BYTES + 1)
    const count = readSync(fd, verified, 0, verified.length, 0)
    const matches =
      descriptorStat.dev === pathStat.dev &&
      descriptorStat.ino === pathStat.ino &&
      descriptorStat.size === LEASE_KEY_BYTES &&
      count === LEASE_KEY_BYTES &&
      timingSafeEqual(verified.subarray(0, LEASE_KEY_BYTES), key)
    verified.fill(0)
    assert(matches, 'Lease key temporary verification failed; refusing publication.')
    linkSync(temporaryPath, keyPath)
  } catch (error) {
    failure = error
  }
  const cleanup = (action: () => void) => {
    try {
      action()
    } catch (error) {
      failure ??= error
    }
  }
  if (fd !== undefined) {
    cleanup(() => closeSync(fd!))
  }
  if (ownsTemporary) {
    cleanup(() => unlinkSync(temporaryPath))
  }
  if (failure !== undefined) {
    throw failure
  }
}

function noFollowFlag() {
  assert(
    constants.O_NOFOLLOW,
    'This platform does not provide no-follow file opens for lease keys.'
  )
  return constants.O_NOFOLLOW
}
