/**
 * Exact spellings chat.db may use for the configured handle. Why: Messages
 * stores phones in E.164 ('+15551234567') while the setting is often typed as a
 * bare 10-digit US number. Emails compare lower-cased; never a substring.
 */
export function selfHandleSpellings(selfHandle: string): string[] {
  const trimmed = selfHandle.trim().toLowerCase()
  if (trimmed.includes('@')) {
    return [trimmed]
  }
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 0) {
    return [trimmed]
  }
  let national: string | null = null
  if (digits.length === 10) {
    national = digits
  } else if (digits.length === 11 && digits.startsWith('1')) {
    national = digits.slice(1)
  }
  const spellings = national
    ? [`+1${national}`, `1${national}`, national]
    : [`+${digits}`, digits]
  return [...new Set([trimmed, ...spellings])]
}
