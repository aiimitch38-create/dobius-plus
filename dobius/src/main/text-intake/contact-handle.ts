// One canonical form for a contact's handle (Codex P1 on 7.17): used by the
// poller's SQL filter, ingest, createDraft and sendDraft alike.
//   - email: trimmed, lower-cased, exact.
//   - phone with an explicit "+": kept as "+<digits>", never re-guessed.
//   - bare 10 digits: a US number, "+1<digits>".
//   - bare 11 digits starting with 1: "+<digits>".
//   - any other bare digits: "+<digits>" (a typed country code without the "+").
// Why: the old spelling rule read +4798765432 (Norway) as a 10-digit US number
// and matched it to +14798765432.

export function canonicalHandle(raw: string): string {
  const trimmed = raw.trim().toLowerCase()
  if (trimmed.includes('@')) {
    return trimmed
  }
  const digits = trimmed.replace(/\D/g, '')
  if (!digits) {
    return trimmed
  }
  if (trimmed.startsWith('+')) {
    return `+${digits}`
  }
  if (digits.length === 10) {
    return `+1${digits}`
  }
  return `+${digits}`
}

export function sameContactHandle(a: string, b: string): boolean {
  return canonicalHandle(a) === canonicalHandle(b)
}

/**
 * The exact lower-cased spellings chat.db may store for this handle: only
 * those whose own canonical form is the same number, so a bare
 * "4798765432" (read as US) is never a spelling of +4798765432.
 */
export function contactHandleSpellings(raw: string): string[] {
  const canonical = canonicalHandle(raw)
  if (canonical.includes('@') || !canonical.startsWith('+')) {
    return [canonical]
  }
  const digits = canonical.slice(1)
  const candidates = [canonical, digits]
  if (digits.length === 11 && digits.startsWith('1')) {
    candidates.push(digits.slice(1))
  }
  return [...new Set(candidates.filter((spelling) => canonicalHandle(spelling) === canonical))]
}
