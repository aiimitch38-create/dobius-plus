// What the library may store and show. Two existing filters do the work: the
// observability redactor (replaces keys, labelled values, URL passwords, .env
// lines in place) and quick hands' looksSecret (refuses a whole line that
// looks like a credential). The library adds a check for random-looking long
// tokens, because looksSecret's own long-token rule also matches file paths.
import { basename } from 'node:path'
import { looksSecret } from '../jarvis/live-voice-terminal-text'
import { redactString } from '../observability/redactor'

/** Folders never walked or indexed, at any depth. */
export const LIBRARY_SKIPPED_DIRS: ReadonlySet<string> = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  'vendor',
  'coverage',
  '.cache',
  '.turbo',
  '.venv',
  'venv',
  '__pycache__',
  'Pods',
  'DerivedData',
  'target',
  '.pnpm-store',
  '.trash',
  '.obsidian'
])

const SECRET_FILE_NAMES = [
  /^\.env(?:\..*)?$/i,
  /\.env$/i,
  /\.(?:pem|key|p12|pfx|keychain|keychain-db|kdbx)$/i,
  /^id_[a-z0-9]+(?:\.pub)?$/i,
  /^auth\.json$/i,
  /^credentials?/i,
  /^tokens?(?:[._-]|$)/i,
  /^dobius-runtime.*\.json$/i,
  /^\.?netrc$/i,
  /(?:^|[\s_-])(?:api[\s_-]?keys?|passwords?)(?:[\s._-]|$)/i
]

/** True for a path the library must never read: secret files and skipped folders. */
export function isSecretOrSkippedPath(path: string): boolean {
  const parts = path.split(/[\\/]+/)
  if (parts.slice(0, -1).some((part) => LIBRARY_SKIPPED_DIRS.has(part))) {
    return true
  }
  const name = basename(path)
  return SECRET_FILE_NAMES.some((pattern) => pattern.test(name))
}

const LONG_RUN = /[A-Za-z0-9+/=_.-]{24,}/g

/** A long run that looks generated (a key, a hash) rather than a path or a word. */
function isRandomToken(run: string): boolean {
  if (/^[0-9a-f]{32,}$/i.test(run)) {
    return true
  }
  if (/[+=]/.test(run) && run.length >= 32 && /\d/.test(run)) {
    return true
  }
  return run
    .split(/[/._-]+/)
    .some((segment) => segment.length >= 20 && /\d/.test(segment) && /[A-Za-z]/.test(segment))
}

function maskRandomTokens(line: string): string {
  return line.replace(LONG_RUN, (run) => (isRandomToken(run) ? '[redacted]' : run))
}

/** looksSecret, minus its long-token rule (paths), which isRandomToken covers. */
function lineLooksSecret(line: string): boolean {
  return looksSecret(line.replace(LONG_RUN, ' '))
}

export type ScrubbedText = { text: string; secretWords: number; words: number }

const REDACTION = /\[redacted[^\]]*\]/g

function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length
}

/** Redact secrets in place and drop credential-looking lines, counting words lost. */
export function scrubText(text: string): ScrubbedText {
  const kept: string[] = []
  let secretWords = 0
  let words = 0
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') {
      kept.push('')
      continue
    }
    words += wordCount(raw)
    const line = maskRandomTokens(redactString(raw))
    if (lineLooksSecret(line)) {
      secretWords += wordCount(raw)
      continue
    }
    const markers = line.match(REDACTION)?.length ?? 0
    // Words a redaction swallowed, plus the redactions themselves.
    secretWords += Math.max(0, wordCount(raw) - wordCount(line)) + markers
    kept.push(line)
  }
  return { text: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim(), secretWords, words }
}

/**
 * Text fit to store, or null when the chunk is mostly secret. Why a ratio: a
 * chunk that was half keys is a credentials dump; what is left of it would
 * only be noise around the redactions.
 */
export function scrubForIndex(text: string): string | null {
  const scrubbed = scrubText(text)
  if (scrubbed.words === 0 || scrubbed.secretWords / scrubbed.words > 0.5) {
    return null
  }
  return scrubbed.text.length > 0 ? scrubbed.text : null
}

export const HIDDEN_SNIPPET = '(passage hidden: it looked like a credential)'

/**
 * A search snippet, filtered again before it leaves the index. Stricter than
 * storage: every long run goes, and a line looksSecret refuses goes whole,
 * because a snippet can be spoken aloud or sent to a voice service.
 */
export function scrubSnippet(snippet: string, maxChars: number): string {
  const lines = redactString(snippet)
    .replace(/[A-Za-z0-9+/=_-]{32,}/g, '…')
    .split(/\s*\n\s*/)
    .filter((line) => line.length > 0 && !looksSecret(line))
  const text = lines.join(' ').replace(/\s+/g, ' ').trim()
  if (!/[\p{L}\p{N}]/u.test(text.replace(REDACTION, ''))) {
    return HIDDEN_SNIPPET
  }
  return text.length > maxChars ? `${text.slice(0, maxChars - 1).trimEnd()}…` : text
}
