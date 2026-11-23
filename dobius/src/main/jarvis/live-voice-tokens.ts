// A conservative token count for what the live voice is sent (7.13 review).
// Why an estimate: no tokenizer ships in main, and the Live API refuses a
// session.commentary.append over 500 tokens (design doc section 1.3). The
// estimate errs high so dense text in any script stays under the cap.

export const LIVE_COMMENTARY_MAX_TOKENS = 500
// Why 450: headroom under the cap for the event's own wrapping.
export const LIVE_COMMENTARY_TOKEN_BUDGET = 450

const SENTENCE_END = /[.?!。？！]/

/**
 * Per character: ASCII letters, digits and spaces 0.3 (English runs about 0.25),
 * ASCII punctuation 1, other two-byte UTF-8 (accented Latin, Cyrillic, Greek,
 * Arabic, Hebrew) 1, the rest of the BMP (CJK, Thai, Hindi) 1.5, emoji and
 * other astral characters 2.
 */
function costOf(char: string): number {
  const code = char.codePointAt(0) ?? 0
  if (code < 0x80) {
    return /[A-Za-z0-9\s]/.test(char) ? 0.3 : 1
  }
  if (code < 0x800) {
    return 1
  }
  return code < 0x10000 ? 1.5 : 2
}

export function estimateTokens(text: string): number {
  let total = 0
  for (const char of text) {
    total += costOf(char)
  }
  return Math.ceil(total)
}

/**
 * `text` cut to `budget` estimated tokens: at a sentence end when one is past
 * a third of the kept text, else with an ellipsis, then the tail.
 */
export function fitTokens(text: string, budget: number, tail = ' The rest is in the thread.'): string {
  if (estimateTokens(text) <= budget) {
    return text
  }
  const room = budget - estimateTokens(`…${tail}`)
  const chars = [...text]
  let used = 0
  let kept = 0
  while (kept < chars.length && used + costOf(chars[kept]) <= room) {
    used += costOf(chars[kept])
    kept += 1
  }
  let end = kept
  while (end > kept / 3 && !SENTENCE_END.test(chars[end - 1] ?? '')) {
    end -= 1
  }
  const cut = end > kept / 3 ? chars.slice(0, end).join('') : `${chars.slice(0, kept).join('').trimEnd()}…`
  return `${cut}${tail}`
}
