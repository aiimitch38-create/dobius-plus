import { describe, expect, it } from 'vitest'
import { BACKUP_PASSPHRASE_WORDLIST } from './backup-passphrase-wordlist'
import { generateBackupPassphrase } from './backup-passphrase'

describe('backup-passphrase', () => {
  it('defaults to 6 words separated by a space', () => {
    const phrase = generateBackupPassphrase()
    expect(phrase.split(' ')).toHaveLength(6)
  })

  it('clamps the requested word count into [3, 10]', () => {
    expect(generateBackupPassphrase({ words: 1 }).split(' ')).toHaveLength(3)
    expect(generateBackupPassphrase({ words: 99 }).split(' ')).toHaveLength(10)
  })

  it('honors a custom separator', () => {
    const phrase = generateBackupPassphrase({ words: 4, separator: '-' })
    expect(phrase.split('-')).toHaveLength(4)
  })

  it('only ever picks words from the wordlist', () => {
    const phrase = generateBackupPassphrase({ words: 10 })
    for (const word of phrase.split(' ')) {
      expect(BACKUP_PASSPHRASE_WORDLIST).toContain(word)
    }
  })

  it('produces different passphrases across calls (OS entropy is actually used)', () => {
    const phrases = new Set(Array.from({ length: 20 }, () => generateBackupPassphrase({ words: 8 })))
    expect(phrases.size).toBeGreaterThan(1)
  })
})
