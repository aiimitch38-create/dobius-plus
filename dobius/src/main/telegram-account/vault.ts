import {
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  closeSync
} from 'node:fs'
import { safeStorage } from 'electron'
import { writeSecureFile } from '../../shared/secure-file'
import type { TelegramGroupSummary } from '../../shared/telegram-account'
import { TELEGRAM_INBOUND_EVENT_LIMIT, type TelegramVaultState } from './types'
import { emptyTelegramVaultState } from './types'

const MAX_VAULT_BYTES = 2 * 1024 * 1024

export class TelegramVaultError extends Error {
  constructor(readonly code: 'unavailable' | 'invalid' | 'io') {
    super('Telegram secure storage operation failed')
    this.name = 'TelegramVaultError'
  }
}

export type TelegramCipher = {
  isSecureEncryptionAvailable(): boolean
  encrypt(plaintext: string): Uint8Array
  decrypt(ciphertext: Uint8Array): string
}

export const electronTelegramCipher: TelegramCipher = {
  isSecureEncryptionAvailable() {
    if (!safeStorage.isEncryptionAvailable()) {
      return false
    }
    if (process.platform === 'linux') {
      try {
        return safeStorage.getSelectedStorageBackend() !== 'basic_text'
      } catch {
        return false
      }
    }
    return process.platform === 'darwin' || process.platform === 'win32'
  },
  encrypt(plaintext) {
    return safeStorage.encryptString(plaintext)
  },
  decrypt(ciphertext) {
    return safeStorage.decryptString(Buffer.from(ciphertext))
  }
}

/** Stores all Telegram session and pending-send text only as OS-encrypted bytes. */
export class TelegramAccountVault {
  constructor(
    private readonly filePath: string,
    private readonly cipher: TelegramCipher = electronTelegramCipher
  ) {}

  isSecureStorageAvailable(): boolean {
    try {
      return this.cipher.isSecureEncryptionAvailable()
    } catch {
      return false
    }
  }

  load(): TelegramVaultState {
    this.requireEncryption()
    let fd: number | null = null
    try {
      const before = lstatSync(this.filePath, { bigint: true })
      if (!before.isFile() || before.size > BigInt(MAX_VAULT_BYTES)) {
        throw new TelegramVaultError('invalid')
      }
      const noFollow = fsConstants.O_NOFOLLOW ?? 0
      fd = openSync(this.filePath, fsConstants.O_RDONLY | noFollow)
      const opened = fstatSync(fd, { bigint: true })
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
        throw new TelegramVaultError('invalid')
      }
      const encrypted = readFileSync(fd)
      const after = fstatSync(fd, { bigint: true })
      if (
        encrypted.length > MAX_VAULT_BYTES ||
        after.dev !== opened.dev ||
        after.ino !== opened.ino
      ) {
        throw new TelegramVaultError('invalid')
      }
      const pathAfter = lstatSync(this.filePath, { bigint: true })
      if (!pathAfter.isFile() || pathAfter.dev !== opened.dev || pathAfter.ino !== opened.ino) {
        throw new TelegramVaultError('invalid')
      }
      const parsed: unknown = JSON.parse(this.cipher.decrypt(encrypted))
      return validateVaultState(parsed)
    } catch (error) {
      if (isMissingFile(error)) {
        return emptyTelegramVaultState()
      }
      if (error instanceof TelegramVaultError) {
        throw error
      }
      throw new TelegramVaultError('io')
    } finally {
      if (fd !== null) {
        closeSync(fd)
      }
    }
  }

  save(state: TelegramVaultState): void {
    this.requireEncryption()
    const valid = validateVaultState(state)
    let encrypted: Uint8Array
    try {
      encrypted = this.cipher.encrypt(JSON.stringify(valid))
    } catch {
      throw new TelegramVaultError('unavailable')
    }
    if (encrypted.byteLength === 0 || encrypted.byteLength > MAX_VAULT_BYTES) {
      throw new TelegramVaultError('invalid')
    }
    try {
      writeSecureFile(this.filePath, encrypted)
    } catch {
      throw new TelegramVaultError('io')
    }
  }

  private requireEncryption(): void {
    if (!this.cipher.isSecureEncryptionAvailable()) {
      throw new TelegramVaultError('unavailable')
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function validateVaultState(value: unknown): TelegramVaultState {
  if (isLegacyTelegramVaultState(value)) {
    return { ...value, schemaVersion: 2, inboundEvents: [] }
  }
  if (!isTelegramVaultState(value)) {
    throw new TelegramVaultError('invalid')
  }
  return value
}

function isTelegramVaultState(value: unknown): value is TelegramVaultState {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'schemaVersion',
      'account',
      'session',
      'groups',
      'drafts',
      'outbox',
      'inboundEvents'
    ])
  ) {
    return false
  }
  return (
    isCommonVaultData(value) && value.schemaVersion === 2 && isInboundLedger(value.inboundEvents)
  )
}

type LegacyTelegramVaultState = Omit<TelegramVaultState, 'schemaVersion' | 'inboundEvents'> & {
  schemaVersion: 1
}

function isLegacyTelegramVaultState(value: unknown): value is LegacyTelegramVaultState {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['schemaVersion', 'account', 'session', 'groups', 'drafts', 'outbox']) &&
    value.schemaVersion === 1 &&
    isCommonVaultData(value)
  )
}

function isCommonVaultData(value: Record<string, unknown>): boolean {
  if (!isTelegramIdentity(value.account) || !isNullableString(value.session)) {
    return false
  }
  if (value.session && value.session.length > 32_000) {
    return false
  }
  if (
    !Array.isArray(value.groups) ||
    value.groups.length > 3 ||
    !value.groups.every(isTelegramGroup)
  ) {
    return false
  }
  if (
    !Array.isArray(value.drafts) ||
    value.drafts.length > 100 ||
    !value.drafts.every(isTelegramDraft)
  ) {
    return false
  }
  return (
    Array.isArray(value.outbox) &&
    value.outbox.length <= 100 &&
    value.outbox.every(isTelegramOutboxEntry)
  )
}

function isInboundLedger(value: unknown): value is TelegramVaultState['inboundEvents'] {
  return (
    Array.isArray(value) &&
    value.length <= TELEGRAM_INBOUND_EVENT_LIMIT &&
    value.every(
      (item) =>
        isRecord(item) &&
        hasExactKeys(item, ['accountId', 'groupId', 'messageId', 'admittedAt', 'state']) &&
        isId(item.accountId) &&
        isId(item.groupId) &&
        isId(item.messageId) &&
        Number.isSafeInteger(item.admittedAt) &&
        (item.admittedAt as number) >= 0 &&
        ['processing', 'manual-review', 'draft-created'].includes(String(item.state))
    )
  )
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isTelegramIdentity(value: unknown): value is TelegramVaultState['account'] {
  return (
    value === null || (isRecord(value) && hasExactKeys(value, ['userId']) && isId(value.userId))
  )
}

function isTelegramGroup(value: unknown): value is TelegramGroupSummary {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['id', 'title', 'kind']) &&
    isId(value.id) &&
    isBoundedString(value.title, 200) &&
    (value.kind === 'group' || value.kind === 'supergroup')
  )
}

function isTelegramDraft(value: unknown): value is TelegramVaultState['drafts'][number] {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'id',
      'revision',
      'groupId',
      'groupTitle',
      'senderId',
      'sourceMessageId',
      'consentRevision',
      'body',
      'state',
      'createdAt'
    ]) &&
    isBoundedString(value.id, 100) &&
    Number.isSafeInteger(value.revision) &&
    (value.revision as number) > 0 &&
    isId(value.groupId) &&
    isBoundedString(value.groupTitle, 200) &&
    isId(value.senderId) &&
    isId(value.sourceMessageId) &&
    isBoundedString(value.consentRevision, 128) &&
    isBoundedString(value.body, 4096) &&
    ['awaiting-approval', 'approved', 'sending', 'sent', 'unknown'].includes(String(value.state)) &&
    Number.isSafeInteger(value.createdAt) &&
    (value.createdAt as number) >= 0
  )
}

function isTelegramOutboxEntry(value: unknown): value is TelegramVaultState['outbox'][number] {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['key', 'draftId', 'groupId', 'body', 'randomId', 'state']) &&
    isBoundedString(value.key, 300) &&
    isBoundedString(value.draftId, 100) &&
    isId(value.groupId) &&
    isBoundedString(value.body, 4096) &&
    /^-?\d{1,20}$/.test(String(value.randomId)) &&
    ['prepared', 'unknown', 'sent'].includes(String(value.state))
  )
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort()
  return (
    actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index])
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
