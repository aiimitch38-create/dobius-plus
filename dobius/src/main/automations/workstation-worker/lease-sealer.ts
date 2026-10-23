import { strict as assert } from 'node:assert'
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  constants,
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync
} from 'node:fs'
import type { Stats } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { LeaseSealer } from '../../../shared/workstation-worker'
import { LEASE_KEY_BYTES as KEY_BYTES, writeAndPublishKey } from './lease-sealer-key-file'

const NONCE_BYTES = 12,
  TAG_BYTES = 16,
  TOKEN_MIN_BYTES = 32,
  TOKEN_MAX_BYTES = 512
const VERSION = 'v1'
const AAD = Buffer.from('dobius/workstation-worker/lease-sealer:v1', 'utf8')
const MAX_SEALED_TOKEN_CHARS =
  'sealed:v1:'.length + Math.ceil(((NONCE_BYTES + TAG_BYTES + TOKEN_MAX_BYTES) * 4) / 3)

export type DurableLeaseSealerOptions = {
  stateDirectory: string
  journalPath: string
}

export function openDurableLeaseSealer(options: DurableLeaseSealerOptions): LeaseSealer {
  if (process.platform === 'win32' || typeof process.getuid !== 'function') {
    throw new Error(
      'Durable lease sealing is unsupported without verified POSIX ownership controls.'
    )
  }
  const uid = process.getuid()
  const { stateDirectory, journalPath } = options
  if (!isAbsolute(stateDirectory) || realpathSync(stateDirectory) !== stateDirectory) {
    throw new Error('Lease key state directory must be an existing canonical absolute path.')
  }
  const stateStat = lstatSync(stateDirectory) as Stats
  assertPrivateDirectory(stateStat, uid)
  const keyPath = join(stateDirectory, 'lease-sealer.key')
  const key = loadOrCreateKey(keyPath, stateDirectory, journalPath, uid)
  const identity = identityOf(lstatSync(keyPath) as Stats)
  assertPinnedDirectory(stateDirectory, stateStat, uid)

  const verifyKeyStillPinned = () => {
    const current = readKeyFile(keyPath, uid)
    try {
      const currentIdentity = identityOf(current.stat)
      if (
        currentIdentity.dev !== identity.dev ||
        currentIdentity.ino !== identity.ino ||
        !timingSafeEqual(current.bytes, key)
      ) {
        throw new Error('Lease sealing key identity changed; refusing rotation.')
      }
    } finally {
      current.bytes.fill(0)
    }
    const currentState = lstatSync(stateDirectory) as Stats
    const stateIdentity = identityOf(currentState)
    assert(
      currentState.isDirectory() &&
        !currentState.isSymbolicLink() &&
        stateIdentity.dev === stateStat.dev &&
        stateIdentity.ino === stateStat.ino,
      'Lease key state directory identity changed.'
    )
    assertPrivateDirectory(currentState, uid)
  }

  return {
    seal(token: string) {
      verifyTokenSize(token)
      verifyKeyStillPinned()
      const nonce = randomBytes(NONCE_BYTES)
      const cipher = createCipheriv('aes-256-gcm', key, nonce)
      cipher.setAAD(AAD)
      const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
      const tag = cipher.getAuthTag()
      return `sealed:${VERSION}:${Buffer.concat([nonce, tag, ciphertext]).toString('base64url')}`
    },
    unseal(sealedToken: string) {
      assert(
        sealedToken.length <= MAX_SEALED_TOKEN_CHARS,
        'Sealed lease token is outside the supported size bounds.'
      )
      verifyKeyStillPinned()
      const encoded = /^sealed:v1:([A-Za-z0-9_-]+)$/.exec(sealedToken)
      if (!encoded) {
        throw new Error('Sealed lease token has an unsupported format or version.')
      }
      const payload = Buffer.from(encoded[1]!, 'base64url')
      assert(
        payload.length >= NONCE_BYTES + TAG_BYTES + TOKEN_MIN_BYTES &&
          payload.length <= NONCE_BYTES + TAG_BYTES + TOKEN_MAX_BYTES,
        'Sealed lease token is outside the supported size bounds.'
      )
      const nonce = payload.subarray(0, NONCE_BYTES)
      const tag = payload.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES)
      const ciphertext = payload.subarray(NONCE_BYTES + TAG_BYTES)
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, nonce)
        decipher.setAAD(AAD)
        decipher.setAuthTag(tag)
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
        const token = plaintext.toString('utf8')
        if (!Buffer.from(token, 'utf8').equals(plaintext)) {
          throw new Error('Sealed lease token is not valid UTF-8.')
        }
        verifyTokenSize(token)
        return token
      } catch {
        throw new Error('Sealed lease authentication failed; worker remains fenced.')
      }
    }
  }
}

function loadOrCreateKey(
  keyPath: string,
  stateDirectory: string,
  journalPath: string,
  uid: number
) {
  try {
    return readKeyFile(keyPath, uid).bytes
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
  if (pathExistsWithoutFollowing(journalPath)) {
    throw new Error('Lease key is missing while an attempt journal exists; refusing key rotation.')
  }
  const temporaryPath = join(stateDirectory, `.lease-sealer-${randomBytes(12).toString('hex')}.tmp`)
  const generated = randomBytes(KEY_BYTES)
  try {
    writeAndPublishKey(temporaryPath, keyPath, generated)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error
    }
  } finally {
    generated.fill(0)
    syncDirectory(stateDirectory, uid)
  }
  return readKeyFile(keyPath, uid).bytes
}

function readKeyFile(path: string, uid: number) {
  const before = lstatSync(path) as Stats
  assertKeyFile(before, uid)
  let fd: number | undefined
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | noFollowFlag())
    const stat = fstatSync(fd) as Stats
    assertKeyFile(stat, uid)
    assert(
      before.dev === stat.dev && before.ino === stat.ino,
      'Lease key changed while it was opened.'
    )
    const bytes = Buffer.alloc(KEY_BYTES + 1)
    const count = readSync(fd, bytes, 0, bytes.length, 0)
    if (count !== KEY_BYTES) {
      bytes.fill(0)
      throw new Error('Lease key must contain exactly 256 bits.')
    }
    return { bytes: bytes.subarray(0, KEY_BYTES), stat }
  } finally {
    if (fd !== undefined) {
      closeSync(fd)
    }
  }
}

function assertPrivateDirectory(stat: Stats, uid: number) {
  assert(
    stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      stat.uid === uid &&
      (stat.mode & 0o777) === 0o700,
    'Lease state directory must be service-owned mode 0700 and not a symlink.'
  )
}

function assertKeyFile(stat: Stats, uid: number) {
  assert(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.uid === uid &&
      (stat.mode & 0o777) === 0o600 &&
      stat.size === KEY_BYTES,
    'Lease key must be a service-owned regular mode 0600 file of exactly 32 bytes.'
  )
}

function pathExistsWithoutFollowing(path: string) {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw error
  }
}

function identityOf(stat: Stats) {
  return { dev: stat.dev, ino: stat.ino }
}

function assertPinnedDirectory(path: string, expected: Stats, uid: number) {
  const current = lstatSync(path) as Stats
  assertPrivateDirectory(current, uid)
  assert(
    current.dev === expected.dev && current.ino === expected.ino,
    'Lease key state directory identity changed during initialization.'
  )
}

function syncDirectory(path: string, uid: number) {
  assert(
    constants.O_DIRECTORY,
    'This platform does not provide safe directory handles for lease key durability.'
  )
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NONBLOCK | noFollowFlag()
  )
  try {
    const stat = fstatSync(fd) as Stats
    assertPrivateDirectory(stat, uid)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

function verifyTokenSize(token: string) {
  const size = Buffer.byteLength(token, 'utf8')
  assert(
    size >= TOKEN_MIN_BYTES && size <= TOKEN_MAX_BYTES,
    'Lease token is outside the supported size bounds.'
  )
}

function noFollowFlag() {
  assert(
    constants.O_NOFOLLOW,
    'This platform does not provide no-follow file opens for lease keys.'
  )
  return constants.O_NOFOLLOW
}
