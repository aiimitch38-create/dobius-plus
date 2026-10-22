import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs'
import { writeSecureFile } from '../../shared/secure-file'
import { electronTelegramCipher, type TelegramCipher } from '../telegram-account/vault'

export type TelegramApplicationCredentials = { apiId: number; apiHash: string }

export function validTelegramApplicationCredentials(
  input: unknown
): input is TelegramApplicationCredentials {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return false
  }
  const value = input as Record<string, unknown>
  return (
    Object.keys(value).length === 2 &&
    Number.isSafeInteger(value.apiId) &&
    (value.apiId as number) > 0 &&
    (value.apiId as number) <= 2_147_483_647 &&
    typeof value.apiHash === 'string' &&
    /^[a-fA-F0-9]{32}$/.test(value.apiHash)
  )
}

/** Separate from settings and renderer state; this file contains only ciphertext. */
export class TelegramApplicationCredentialStore {
  constructor(
    private readonly path: string,
    private readonly cipher: TelegramCipher = electronTelegramCipher
  ) {}

  save(input: unknown): void {
    if (!validTelegramApplicationCredentials(input)) {
      throw new Error('invalid-input')
    }
    this.requireEncryption()
    try {
      const bytes = this.cipher.encrypt(JSON.stringify(input))
      if (bytes.byteLength === 0 || bytes.byteLength > 4096) {
        throw new Error('invalid-credential-envelope')
      }
      writeSecureFile(this.path, bytes)
    } catch {
      throw new Error('storage-failed')
    }
  }

  load(): TelegramApplicationCredentials {
    this.requireEncryption()
    let fd: number | undefined
    try {
      const before = lstatSync(this.path)
      if (!before.isFile() || before.size > 4096) {
        throw new Error('invalid-credential-envelope')
      }
      fd = openSync(this.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      const opened = fstatSync(fd)
      if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev) {
        throw new Error('invalid-credential-envelope')
      }
      const bytes = readFileSync(fd)
      const after = lstatSync(this.path)
      if (
        bytes.byteLength > 4096 ||
        !after.isFile() ||
        after.ino !== opened.ino ||
        after.dev !== opened.dev
      ) {
        throw new Error('invalid-credential-envelope')
      }
      const input: unknown = JSON.parse(this.cipher.decrypt(bytes))
      if (!validTelegramApplicationCredentials(input)) {
        throw new Error('invalid-credential-envelope')
      }
      return input
    } catch {
      // Never forward filesystem or crypto exceptions, which can contain private input.
      throw new Error('authorization-failed')
    } finally {
      if (fd !== undefined) {
        closeSync(fd)
      }
    }
  }

  private requireEncryption(): void {
    if (!this.cipher.isSecureEncryptionAvailable()) {
      throw new Error('secure-storage-unavailable')
    }
  }
}
