import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { TelegramConsentAuthority } from './consent-authority'
import type { TelegramCipher } from './vault'

const directories: string[] = []
const now = 1800000000000
const subject = { accountId: '77', groupId: '-101', senderId: '88' }
const grant = {
  ...subject,
  displayName: 'Verified participant',
  evidence: 'Participant explicitly agreed in message 123.',
  expiresAt: now + 86400000
}
const cipher: TelegramCipher = {
  isSecureEncryptionAvailable: () => true,
  encrypt: (text) => Buffer.from(`cipher:${Buffer.from(text).toString('base64')}`),
  decrypt: (bytes) => {
    const text = Buffer.from(bytes).toString()
    if (!text.startsWith('cipher:')) {
      throw new Error('private cipher failure')
    }
    return Buffer.from(text.slice(7), 'base64').toString()
  }
}
function file(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dobius-consent-'))
  directories.push(directory)
  return join(directory, 'consents.enc')
}
afterEach(() =>
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }))
)

describe('Telegram per-participant consent authority', () => {
  it('persists encrypted evidence across reopen, bound to account, group, sender and purpose', () => {
    const path = file()
    const authority = new TelegramConsentAuthority(path, cipher, () => now)
    expect(authority.read('77', '-101', '88').allowed).toBe(false)
    authority.grant(grant)
    const reopened = new TelegramConsentAuthority(path, cipher, () => now)
    expect(reopened.read('77', '-101', '88').allowed).toBe(true)
    expect(
      new TelegramConsentAuthority(path, cipher, () => now - 1).read('77', '-101', '88').allowed
    ).toBe(false)
    expect(reopened.read('78', '-101', '88').allowed).toBe(false)
    expect(reopened.read('77', '-102', '88').allowed).toBe(false)
    expect(reopened.read('77', '-101', '89').allowed).toBe(false)
    expect(reopened.list('77')[0]).toMatchObject({
      displayName: grant.displayName,
      evidence: grant.evidence
    })
    expect(reopened.list('78')).toEqual([])
    expect(readFileSync(path, 'utf8')).not.toContain(grant.evidence)
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o600)
    }
  })

  it('expires exactly at the deadline and revokes with a new durable revision', () => {
    const path = file()
    const authority = new TelegramConsentAuthority(path, cipher, () => now)
    authority.grant(grant)
    const previous = authority.read('77', '-101', '88').revision
    const expired = new TelegramConsentAuthority(path, cipher, () => grant.expiresAt)
    expect(expired.read('77', '-101', '88').allowed).toBe(false)
    expect(expired.list('77')).toHaveLength(1)
    authority.revoke(subject)
    const proof = new TelegramConsentAuthority(path, cipher, () => now).read('77', '-101', '88')
    expect(proof.allowed).toBe(false)
    expect(proof.revision).not.toBe(previous)
    expect(authority.list('77')).toEqual([])
    authority.grant(grant)
    expect(authority.read('77', '-101', '88').revision).not.toBe(proof.revision)
  })

  it.each([
    { ...grant, evidence: '' },
    { ...grant, evidence: 'a'.repeat(1001) },
    { ...grant, expiresAt: now },
    { ...grant, expiresAt: now + 366 * 86400000 },
    { ...grant, senderId: '*' },
    { ...grant, accountId: '' },
    { ...grant, groupId: 'all-groups' }
  ])('refuses incomplete, blanket or unbounded grants %#', (input) => {
    expect(() => new TelegramConsentAuthority(file(), cipher, () => now).grant(input)).toThrow(
      'invalid-input'
    )
  })

  it('fails closed on ciphertext, malformed records, duplicate subjects, wrong purpose and symlinks', () => {
    const path = file()
    const authority = new TelegramConsentAuthority(path, cipher, () => now)
    authority.grant(grant)
    const state = JSON.parse(cipher.decrypt(readFileSync(path)))
    for (const malformed of [
      { ...state, schemaVersion: 2 },
      { ...state, records: [...state.records, ...state.records] },
      { ...state, records: [{ ...state.records[0], purpose: 'anything' }] },
      { ...state, records: [{ ...state.records[0], revokedAt: 'no' }] }
    ]) {
      writeFileSync(path, cipher.encrypt(JSON.stringify(malformed)))
      expect(() => authority.read('77', '-101', '88')).toThrow(/^storage-failed$/)
    }
    writeFileSync(path, 'corrupt-private-material')
    expect(() => authority.list('77')).toThrow(/^storage-failed$/)
    const link = `${path}.link`
    symlinkSync(path, link)
    expect(() => new TelegramConsentAuthority(link, cipher).list('77')).toThrow(/^storage-failed$/)
  })

  it('never falls back to plaintext when encryption is unavailable or throws', () => {
    for (const available of [
      () => false,
      () => {
        throw new Error('OS failure')
      }
    ]) {
      const authority = new TelegramConsentAuthority(
        file(),
        { ...cipher, isSecureEncryptionAvailable: available },
        () => now
      )
      expect(() => authority.grant(grant)).toThrow(/^secure-storage-unavailable$/)
      expect(() => authority.read('77', '-101', '88')).toThrow(/^secure-storage-unavailable$/)
    }
  })
})
