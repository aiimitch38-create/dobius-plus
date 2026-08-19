// Word-based backup passphrase generator (protects an ncryptsec export, not
// a signing key by itself). Uses node:crypto's OS entropy source with
// rejection sampling, so every word is drawn uniformly from the wordlist —
// no modulo bias.
import { randomInt } from 'node:crypto'
import { BACKUP_PASSPHRASE_WORDLIST } from './backup-passphrase-wordlist'

const MIN_WORDS = 3
const MAX_WORDS = 10
const DEFAULT_WORDS = 6
const DEFAULT_SEPARATOR = ' '

export type GenerateBackupPassphraseOptions = {
  words?: number
  separator?: string
}

function clampWordCount(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return DEFAULT_WORDS
  }
  return Math.min(MAX_WORDS, Math.max(MIN_WORDS, Math.trunc(requested)))
}

/** Generates a passphrase from `BACKUP_PASSPHRASE_WORDLIST` using OS entropy (node:crypto randomInt). */
export function generateBackupPassphrase(options: GenerateBackupPassphraseOptions = {}): string {
  const wordCount = clampWordCount(options.words)
  const separator = options.separator ?? DEFAULT_SEPARATOR
  const picks: string[] = []
  for (let i = 0; i < wordCount; i += 1) {
    picks.push(BACKUP_PASSPHRASE_WORDLIST[randomInt(0, BACKUP_PASSPHRASE_WORDLIST.length)])
  }
  return picks.join(separator)
}
