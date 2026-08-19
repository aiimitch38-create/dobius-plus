/**
 * Defense-in-depth guard against ever writing credential-shaped material
 * into an exported snapshot. A snapshot leaves the machine (it's exported
 * to a file or sent as a message attachment), so unlike an ordinary local
 * store, "never embeds a token" has to be enforced at the export boundary
 * itself, not just by which fields the source records happen to expose.
 *
 * Same heuristic as team-store.ts's isTokenShapedCandidate (long opaque
 * strings, `sk-`/`Bearer ` prefixes, JWT-shaped triples) — reimplemented
 * locally rather than imported because team-store.ts's version is a private,
 * unexported function and this task does not edit that file. Kept in sync
 * in spirit: an opaque Dobius account id is a short randomUUID(), which
 * always passes; anything shaped like a real credential is rejected.
 */
export function looksTokenShaped(value: string): boolean {
  if (value.length > 128) {
    return true
  }
  if (/^(sk-|bearer\s|ghp_|gho_|xox[baprs]-)/i.test(value)) {
    return true
  }
  // JWT-shaped: three base64url segments separated by '.'
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) {
    return true
  }
  return false
}

/** Returns the value only if it's a safe-to-export opaque id; null otherwise (fail closed, never throw). */
export function safeAccountIdOrNull(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed || looksTokenShaped(trimmed)) {
    return null
  }
  return trimmed
}
