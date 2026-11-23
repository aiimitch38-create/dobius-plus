// What a quick hand may say about a terminal's output: the last line, with
// escapes gone, never anything that looks like a credential.

const MAX_SPOKEN_CHARS = 150

// oxlint-disable-next-line no-control-regex -- stripping terminal escapes is the point
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-_]/g

/** The last output line with a letter or digit, whole, without escapes or control characters. */
export function lastOutputLine(lines: string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]
      .replace(ANSI, '')
      // oxlint-disable-next-line no-control-regex -- removing control characters is the point
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (/[A-Za-z0-9]/.test(line)) {
      return line
    }
  }
  return null
}

/** A line cut to about 150 characters, short enough to say. */
export function shortForSpeech(line: string): string {
  return line.length > MAX_SPOKEN_CHARS
    ? `${line.slice(0, MAX_SPOKEN_CHARS - 1).trimEnd()}…`
    : line
}

/** The last output line, cut short enough to say. */
export function lastSpokenLine(lines: string[]): string | null {
  const line = lastOutputLine(lines)
  return line === null ? null : shortForSpeech(line)
}

// Why so broad: a read line is spoken aloud and lands in the thread; a git
// hash or a "Basic setup" line refused now and then costs less than a key
// read out on a call. Checked on the whole line, before it is cut short.
const SECRET_SHAPED = [
  /\bsk-[A-Za-z0-9_-]{6,}/,
  /\bek_[A-Za-z0-9_-]{6,}/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{6,}/,
  /\bgithub_pat_[A-Za-z0-9_]{6,}/,
  /\bxox[bpas]-[A-Za-z0-9-]{6,}/,
  /\b(?:AKIA|ASIA)[0-9A-Z]{12,}/,
  /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\bbasic\s+[A-Za-z0-9+/]+={0,2}/i,
  /[A-Za-z0-9+/=_-]{32,}/,
  // A credential field, bare or quoted: password: x, "token": "x", api_key='x', {"secret":"x"}.
  /(?:^|[^A-Za-z])(?:password|passwd|pwd|secret|token|api[\s_-]?key|access[\s_-]?key|auth)s?["']?\s*[:=]/i
]

/** True when a line holds anything that looks like a key, token or password. */
export function looksSecret(line: string): boolean {
  return SECRET_SHAPED.some((pattern) => pattern.test(line))
}
