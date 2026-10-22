import { randomUUID } from 'node:crypto'
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs'
import { writeSecureFile } from '../../shared/secure-file'
import type { TelegramParticipantConsent } from '../../shared/telegram-account-api'
import type { ChatConsentProof } from './types'
import type { TelegramCipher } from './vault'

const PURPOSE = 'adam-telegram-reply' as const
const MAX_BYTES = 4 * 1024 * 1024
const MAX_GRANTS = 2000
const MAX_DURATION = 365 * 24 * 60 * 60 * 1000

type ConsentRecord = TelegramParticipantConsent & {
  accountId: string
  purpose: typeof PURPOSE
  revokedAt: number | null
}
type ConsentState = { schemaVersion: 1; records: ConsentRecord[] }
export type TelegramConsentSubject = { accountId: string; groupId: string; senderId: string }
export type TelegramConsentGrant = TelegramConsentSubject & {
  displayName: string
  evidence: string
  expiresAt: number
}

/** Records evidence supplied by the account owner, not an inference of another person's consent. */
export class TelegramConsentAuthority {
  constructor(
    private readonly filePath: string,
    private readonly cipher: TelegramCipher,
    private readonly now: () => number = Date.now
  ) {}

  list(accountId: string): TelegramParticipantConsent[] {
    assertId(accountId)
    return this.load()
      .records.filter((record) => record.accountId === accountId && record.revokedAt === null)
      .map(({ groupId, senderId, displayName, evidence, grantedAt, expiresAt, revision }) => ({
        groupId,
        senderId,
        displayName,
        evidence,
        grantedAt,
        expiresAt,
        revision
      }))
  }

  read(accountId: string, groupId: string, senderId: string): ChatConsentProof {
    const subject = { accountId, groupId, senderId }
    assertSubject(subject)
    const record = this.load().records.find((candidate) => matches(candidate, subject))
    const now = this.now()
    return {
      allowed:
        !!record && record.revokedAt === null && record.grantedAt <= now && record.expiresAt > now,
      revision: record?.revision ?? 'ungranted'
    }
  }

  grant(input: TelegramConsentGrant): void {
    assertSubject(input)
    const now = this.now()
    if (
      !bounded(input.displayName, 200) ||
      !bounded(input.evidence, 1000) ||
      input.evidence.trim().length < 10 ||
      !Number.isSafeInteger(input.expiresAt) ||
      input.expiresAt <= now ||
      input.expiresAt > now + MAX_DURATION
    ) {
      throw new Error('invalid-input')
    }
    const state = this.load()
    const previous = state.records.findIndex((record) => matches(record, input))
    const record: ConsentRecord = {
      accountId: input.accountId,
      groupId: input.groupId,
      senderId: input.senderId,
      displayName: input.displayName.trim(),
      evidence: input.evidence.trim(),
      grantedAt: now,
      expiresAt: input.expiresAt,
      revision: randomUUID(),
      purpose: PURPOSE,
      revokedAt: null
    }
    if (previous < 0) {
      state.records.push(record)
    } else {
      state.records[previous] = record
    }
    if (state.records.length > MAX_GRANTS) {
      throw new Error('storage-failed')
    }
    this.save(state)
  }

  revoke(subject: TelegramConsentSubject): void {
    assertSubject(subject)
    const state = this.load()
    const record = state.records.find((candidate) => matches(candidate, subject))
    if (!record) {
      return
    }
    record.revokedAt = this.now()
    record.revision = randomUUID()
    this.save(state)
  }

  private load(): ConsentState {
    this.requireEncryption()
    let fd: number | null = null
    try {
      const before = lstatSync(this.filePath, { bigint: true })
      if (!before.isFile() || before.size > BigInt(MAX_BYTES)) {
        throw new Error('storage-failed')
      }
      fd = openSync(this.filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      const opened = fstatSync(fd, { bigint: true })
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
        throw new Error('storage-failed')
      }
      const bytes = readFileSync(fd)
      const after = lstatSync(this.filePath, { bigint: true })
      if (
        !after.isFile() ||
        after.dev !== opened.dev ||
        after.ino !== opened.ino ||
        bytes.length > MAX_BYTES
      ) {
        throw new Error('storage-failed')
      }
      return validateState(JSON.parse(this.cipher.decrypt(bytes)))
    } catch (error) {
      if (fd === null && isMissing(error)) {
        return { schemaVersion: 1, records: [] }
      }
      throw new Error('storage-failed')
    } finally {
      if (fd !== null) {
        closeSync(fd)
      }
    }
  }

  private save(state: ConsentState): void {
    this.requireEncryption()
    try {
      const encrypted = this.cipher.encrypt(JSON.stringify(validateState(state)))
      if (!encrypted.byteLength || encrypted.byteLength > MAX_BYTES) {
        throw new Error('storage-failed')
      }
      writeSecureFile(this.filePath, encrypted)
    } catch {
      throw new Error('storage-failed')
    }
  }

  private requireEncryption(): void {
    try {
      if (this.cipher.isSecureEncryptionAvailable()) {
        return
      }
    } catch {
      /* OS encryption failure must not silently downgrade to plaintext. */
    }
    throw new Error('secure-storage-unavailable')
  }
}

function validateState(value: unknown): ConsentState {
  if (
    !record(value) ||
    !keys(value, ['schemaVersion', 'records']) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.records) ||
    value.records.length > MAX_GRANTS
  ) {
    throw new Error('storage-failed')
  }
  const subjects = new Set<string>()
  for (const item of value.records) {
    if (
      !record(item) ||
      !keys(item, [
        'accountId',
        'groupId',
        'senderId',
        'displayName',
        'evidence',
        'grantedAt',
        'expiresAt',
        'revision',
        'purpose',
        'revokedAt'
      ])
    ) {
      throw new Error('storage-failed')
    }
    assertSubject(item as TelegramConsentSubject)
    if (
      item.purpose !== PURPOSE ||
      !bounded(item.displayName, 200) ||
      !bounded(item.evidence, 1000) ||
      item.evidence.trim().length < 10 ||
      !bounded(item.revision, 128) ||
      !Number.isSafeInteger(item.grantedAt) ||
      (item.grantedAt as number) < 0 ||
      !Number.isSafeInteger(item.expiresAt) ||
      (item.expiresAt as number) <= (item.grantedAt as number) ||
      (item.expiresAt as number) - (item.grantedAt as number) > MAX_DURATION ||
      !(
        item.revokedAt === null ||
        (Number.isSafeInteger(item.revokedAt) &&
          (item.revokedAt as number) >= (item.grantedAt as number))
      )
    ) {
      throw new Error('storage-failed')
    }
    const key = JSON.stringify([item.accountId, item.groupId, item.senderId, item.purpose])
    if (subjects.has(key)) {
      throw new Error('storage-failed')
    }
    subjects.add(key)
  }
  return value as ConsentState
}
function assertSubject(subject: TelegramConsentSubject): void {
  assertId(subject.accountId)
  assertId(subject.senderId)
  assertId(subject.groupId, true)
}
function assertId(value: unknown, signed = false): void {
  if (
    typeof value !== 'string' ||
    !(signed ? /^-?[1-9]\d{0,19}$/ : /^[1-9]\d{0,19}$/).test(value)
  ) {
    throw new Error('invalid-input')
  }
}
function matches(record: ConsentRecord, subject: TelegramConsentSubject): boolean {
  return (
    record.accountId === subject.accountId &&
    record.groupId === subject.groupId &&
    record.senderId === subject.senderId
  )
}
function bounded(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function keys(value: Record<string, unknown>, expected: string[]): boolean {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  )
}
function isMissing(error: unknown): boolean {
  return record(error) && error.code === 'ENOENT'
}
