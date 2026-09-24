// Why: the E2EE keypair enables application-layer encryption between mobile
// and desktop over plain ws://. The public key is embedded in the QR pairing
// offer so the mobile client can derive a shared secret via ECDH.
import { statSync } from 'node:fs'
import { join } from 'node:path'
import nacl from 'tweetnacl'
import { hardenExistingSecureFile, writeSecureJsonFile } from '../../shared/secure-file'
import { readSafeJsonFile } from '../storage/safe-json-file'
import { E2EE_KEYPAIR_FILENAME } from './mobile-pairing-files'

const KEYPAIR_FILENAME = E2EE_KEYPAIR_FILENAME
const KEYPAIR_VERSION = 1
const MAX_KEYPAIR_FILE_BYTES = 8 * 1024

type KeypairFile = {
  v: number
  publicKeyB64: string
  secretKeyB64: string
}

export type E2EEKeypair = {
  publicKey: Uint8Array
  secretKey: Uint8Array
  publicKeyB64: string
}

// Why: the keypair IS the desktop's pairing identity. Replacing it because a
// read failed would silently break every paired phone, so only a missing file
// may create one; anything else must be repaired (or removed) deliberately.
export class E2EEKeypairUnreadableError extends Error {
  constructor(
    readonly filePath: string,
    readonly detail: string
  ) {
    super(
      `E2EE keypair at ${filePath} is unreadable (${detail}); phone pairing is disabled until it is fixed or removed`
    )
    this.name = 'E2EEKeypairUnreadableError'
  }
}

function errorDetail(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    return String(error.code)
  }
  return error instanceof Error ? error.message : String(error)
}

function parseKeypairFile(raw: unknown): E2EEKeypair | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }
  const file = raw as Partial<KeypairFile>
  if (
    file.v !== KEYPAIR_VERSION ||
    typeof file.publicKeyB64 !== 'string' ||
    typeof file.secretKeyB64 !== 'string'
  ) {
    return undefined
  }
  const publicKey = Uint8Array.from(Buffer.from(file.publicKeyB64, 'base64'))
  const secretKey = Uint8Array.from(Buffer.from(file.secretKeyB64, 'base64'))
  if (publicKey.length !== 32 || secretKey.length !== 32) {
    return undefined
  }
  return { publicKey, secretKey, publicKeyB64: file.publicKeyB64 }
}

function createKeypair(filePath: string): E2EEKeypair {
  const keypair = nacl.box.keyPair()
  const publicKeyB64 = Buffer.from(keypair.publicKey).toString('base64')
  const secretKeyB64 = Buffer.from(keypair.secretKey).toString('base64')

  const data: KeypairFile = { v: KEYPAIR_VERSION, publicKeyB64, secretKeyB64 }
  writeSecureJsonFile(filePath, data)

  return { publicKey: keypair.publicKey, secretKey: keypair.secretKey, publicKeyB64 }
}

/** Throws E2EEKeypairUnreadableError instead of replacing an existing keypair it cannot use. */
export function loadOrCreateE2EEKeypair(userDataPath: string): E2EEKeypair {
  const filePath = join(userDataPath, KEYPAIR_FILENAME)

  let size: number
  try {
    size = statSync(filePath).size
  } catch (error) {
    if (errorDetail(error) === 'ENOENT') {
      return createKeypair(filePath)
    }
    throw new E2EEKeypairUnreadableError(filePath, errorDetail(error))
  }
  // Why: this startup path reads synchronously; valid keypair files are tiny.
  if (size > MAX_KEYPAIR_FILE_BYTES) {
    throw new E2EEKeypairUnreadableError(filePath, 'file is too large')
  }
  try {
    hardenExistingSecureFile(filePath)
  } catch (error) {
    throw new E2EEKeypairUnreadableError(filePath, errorDetail(error))
  }
  const result = readSafeJsonFile<E2EEKeypair | null>(filePath, parseKeypairFile, () => null)
  if (result.status === 'missing') {
    return createKeypair(filePath)
  }
  if (result.status === 'unreadable' || !result.value) {
    throw new E2EEKeypairUnreadableError(filePath, result.detail ?? 'unreadable')
  }
  return result.value
}
