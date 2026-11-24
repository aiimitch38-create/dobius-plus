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

const SKIPPED_LOWER = new Set([...LIBRARY_SKIPPED_DIRS].map((name) => name.toLowerCase()))

/** Why case-insensitive: macOS folders are, so "Vendor" and "NODE_MODULES" are the same folders. */
export function isSkippedDirName(name: string): boolean {
  return SKIPPED_LOWER.has(name.toLowerCase())
}

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
  if (parts.slice(0, -1).some((part) => isSkippedDirName(part))) {
    return true
  }
  const name = basename(path)
  return SECRET_FILE_NAMES.some((pattern) => pattern.test(name))
}

// Why on top of the redactor: its userinfo rule knows only http(s), and a
// database or broker URL (postgres://user:pass@host) carries a password the same way.
// Why greedy to the LAST "@" before the path: a password may itself hold an "@".
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#]+@/gi

function redact(text: string): string {
  return redactString(text).replace(URL_USERINFO, '$1[redacted]@')
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

// looksSecret's provider shapes (live-voice-terminal-text.ts), without its
// generic long-token rule. Why a copy: they must run on the original line,
// while the long-token rule may only run with paths taken out, and the jarvis
// module exposes the list as one function. Keep the two in step.
const PROVIDER_SHAPED = [
  /\bsk-[A-Za-z0-9_-]{6,}/,
  /\bek_[A-Za-z0-9_-]{6,}/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{6,}/,
  /\bgithub_pat_[A-Za-z0-9_]{6,}/,
  /\bxox[bpas]-[A-Za-z0-9-]{6,}/,
  /\b(?:AKIA|ASIA)[0-9A-Z]{12,}/,
  /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\bbasic\s+[A-Za-z0-9+/]+={0,2}/i
]

/** Provider shapes on the line as written; looksSecret's other rules with paths taken out. */
function lineLooksSecret(line: string): boolean {
  return PROVIDER_SHAPED.some((pattern) => pattern.test(line)) || looksSecret(line.replace(LONG_RUN, ' '))
}

/** A line that ends in a credential label ("password:"), so the next line is its value. */
const DANGLING_LABEL = /(?:password|passwd|pwd|secret|token|api[\s_-]?key|access[\s_-]?key|auth)s?["']?\s*[:=]\s*["']?\s*$/i

export type ScrubbedText = { text: string; secretWords: number; words: number }

const REDACTION = /\[redacted[^\]]*\]/g

function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length
}

/**
 * Redact secrets and drop credential-looking lines, counting words lost. Why
 * the redactor runs on the whole text first: a label and its value can sit on
 * two lines ("password:" then the value), which a line-by-line pass misses.
 */
export function scrubText(text: string): ScrubbedText {
  const words = wordCount(text)
  const kept: string[] = []
  let dropNext = false
  for (const raw of redact(text).split('\n')) {
    if (raw.trim() === '') {
      kept.push('')
      continue
    }
    const line = maskRandomTokens(raw)
    if (dropNext || lineLooksSecret(line)) {
      dropNext = DANGLING_LABEL.test(line) && !dropNext
      continue
    }
    dropNext = false
    kept.push(line)
  }
  const out = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  const markers = out.match(REDACTION)?.length ?? 0
  // Words removed or swallowed by a redaction, plus the redactions themselves.
  const secretWords = Math.min(words, Math.max(0, words - (wordCount(out) - markers)) + markers)
  return { text: out, secretWords, words }
}

/**
 * Text fit to store, or null when it is mostly secret. Why a ratio: text that
 * was half keys is a credentials dump; what is left would only be noise
 * around the redactions.
 */
export function scrubForIndex(text: string): string | null {
  const scrubbed = scrubText(text)
  if (scrubbed.words === 0 || scrubbed.secretWords / scrubbed.words > 0.5) {
    return null
  }
  return scrubbed.text.length > 0 ? scrubbed.text : null
}

/** A short stored label (title, project name): redacted, one line, never empty. */
export function scrubLabel(label: string, maxChars: number, fallback: string): string {
  const text = scrubSnippet(label, maxChars)
  return text === HIDDEN_SNIPPET ? fallback : text
}

export const HIDDEN_SNIPPET = '(passage hidden: it looked like a credential)'

/**
 * A search snippet, filtered again before it leaves the index. Stricter than
 * storage: every long run goes, and a line looksSecret refuses goes whole,
 * because a snippet can be spoken aloud or sent to a voice service.
 */
export function scrubSnippet(snippet: string, maxChars: number): string {
  const lines = redact(snippet)
    .replace(/[A-Za-z0-9+/=_-]{32,}/g, '…')
    .split(/\s*\n\s*/)
    .filter((line) => line.length > 0 && !looksSecret(line))
  const text = lines.join(' ').replace(/\s+/g, ' ').trim()
  if (!/[\p{L}\p{N}]/u.test(text.replace(REDACTION, ''))) {
    return HIDDEN_SNIPPET
  }
  return text.length > maxChars ? `${text.slice(0, maxChars - 1).trimEnd()}…` : text
}
