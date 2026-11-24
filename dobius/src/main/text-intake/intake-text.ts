// The cheap, model-free rules of text intake (7.17): clean an untrusted
// incoming text, decide whether it asks Carson for something, and title the
// suggested card. No model ever sees the text here.
import { SUGGESTION_TITLE_SNIPPET, TEXT_INTAKE_MAX_TEXT } from '../../shared/text-intake'
import { redactString } from '../observability/redactor'

// Why the extra run rule: a pasted key with no known prefix still has no
// business sitting in a stored text (same shape looksSecret refuses).
const OPAQUE_RUN = /[A-Za-z0-9+/=_-]{32,}/g
// A credential field, bare or quoted, through to the end of its value.
const CREDENTIAL_FIELD =
  /\b(password|passwd|pwd|passcode|secret|token|api[\s_-]?key|access[\s_-]?key)s?["']?\s*[:=]\s*\S+/gi

/** One line, control characters gone, secrets replaced, at most 1,000 characters. */
export function cleanIntakeText(raw: string): string {
  // oxlint-disable-next-line no-control-regex -- removing control characters is the point
  const flat = raw.replace(/[\u0000-\u001F\u007F\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim()
  // Why cut before redacting too: a huge text never stalls the main thread.
  const redacted = redactString(flat.slice(0, TEXT_INTAKE_MAX_TEXT * 2))
    .replace(CREDENTIAL_FIELD, '$1: [redacted]')
    .replace(OPAQUE_RUN, (run) => (/\d/.test(run) && /[A-Za-z]/.test(run) ? '[redacted]' : run))
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

/** "Text from <name>: <first 80 characters>" — a fixed template. */
export function suggestionTitle(contactName: string, text: string): string {
  const snippet =
    text.length > SUGGESTION_TITLE_SNIPPET ? `${text.slice(0, SUGGESTION_TITLE_SNIPPET).trimEnd()}…` : text
  return `Text from ${contactName}: ${snippet}`
}
