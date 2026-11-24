// The cheap, model-free rules of text intake (7.17): clean an untrusted
// incoming text, decide whether it asks Carson for something, and title the
// suggested card. No model ever sees the text here.
import { TEXT_INTAKE_MAX_TEXT } from '../../shared/text-intake'
import { redactString } from '../observability/redactor'

// Why the extra run rule: a pasted key with no known prefix still has no
// business sitting in a stored text (same shape looksSecret refuses).
const OPAQUE_RUN = /[A-Za-z0-9+/=_-]{32,}/g
// A whole auth header: everything after "Authorization:" to the end of its
// LINE (Digest keeps nonce, response and more after the scheme). Run on the
// raw text, before newlines are flattened, so the line end is still known.
const AUTH_HEADER = /\b((?:proxy-)?authorization)["']?\s*[:=][^\r\n]*/gi
// A bare scheme and token anywhere: "Bearer eyJhbGci...".
const AUTH_SCHEME = /\b(basic|bearer|digest)\s+[A-Za-z0-9._~+/=-]{8,}/gi
// A credential field, bare or quoted, with its WHOLE value: a quoted value is
// taken to its real closing quote (an escaped \" inside does not end it), so
// "correct \"horse\" battery staple" goes too.
const CREDENTIAL_FIELD =
  /(["']?)\b(password|passwd|pwd|passcode|secret|client[\s_-]?secret|token|api[\s_-]?key|access[\s_-]?key|auth)s?\1\s*[:=]\s*(?:"(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|\S+)/gi
// Why bounded: a huge text never stalls the main thread; far past what is kept.
const REDACT_INPUT_CHARS = 20_000

/** One line, control characters gone, secrets replaced, at most 1,000 characters. */
export function cleanIntakeText(raw: string): string {
  const headersGone = raw.slice(0, REDACT_INPUT_CHARS).replace(AUTH_HEADER, '$1: [redacted]')
  // oxlint-disable-next-line no-control-regex -- removing control characters is the point
  const flat = headersGone.replace(/[\u0000-\u001F\u007F\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim()
  // Why ours first, then the shared redactor: its labeled-kv rule would eat only
  // "Authorization: Basic" and leave the token, hiding it from the rules above.
  const ours = flat.replace(AUTH_SCHEME, '$1 [redacted]').replace(CREDENTIAL_FIELD, '$2: [redacted]')
  const redacted = redactString(ours).replace(OPAQUE_RUN, (run) =>
    /\d/.test(run) && /[A-Za-z]/.test(run) ? '[redacted]' : run
  )
  // Redacted in full first, then cut, so a cut never splits a value.
  return redacted.slice(0, TEXT_INTAKE_MAX_TEXT).trim()
}

const DAY = '(?:mon|tues|wednes|thurs|fri|satur|sun)day'
const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?'

/** Each rule is one reason a text may ask Carson to do something. */
const ACTIONABLE_RULES: RegExp[] = [
  /\?/,
  /\b(?:can|could|would|will) (?:you|u)\b/i,
  /\b(?:please|pls|plz)\b/i,
  /\bneeds?\b|\bneeded\b/i,
  /\bsend\b/i,
  /\b(?:let me know|lmk|remind|don'?t forget|asap|deadline|due|follow up|call me|text me)\b/i,
  new RegExp(`\\bby (?:${DAY}|tomorrow|tonight|today|noon|eod|end of (?:the )?(?:day|week))\\b`, 'i'),
  new RegExp(`\\b(?:${DAY}|today|tomorrow|tonight|this (?:morning|afternoon|evening|week)|next week)\\b`, 'i'),
  new RegExp(`\\b${MONTH} \\d{1,2}(?:st|nd|rd|th)?\\b`, 'i'),
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/,
  /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/i,
  /\b\d{1,2}:\d{2}\b/
]

/** True when the text reads like a question or request to Carson. Rules only, no model. */
export function isActionableText(text: string): boolean {
  return ACTIONABLE_RULES.some((rule) => rule.test(text))
}

/**
 * "Text from <name>": a fixed template. Why no message words: a card title is
 * interpolated into agent prompts, so untrusted text lives only in the quote.
 */
export function suggestionTitle(contactName: string): string {
  return `Text from ${contactName}`
}
