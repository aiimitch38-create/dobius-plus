// The words of a conductor notice: plain, short, and never a secret.
import { lastOutputLine, looksSecret } from './live-voice-terminal-text'
import type { ConductorRead, ConductorStatus } from './adam-conductor-types'

export const CONDUCTOR_NOTICE_MAX_CHARS = 200
const LABEL_MAX_CHARS = 40
export const CONDUCTOR_LABEL_FALLBACK = 'A terminal'

// oxlint-disable-next-line no-control-regex -- stripping terminal escapes is the point
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-_]/g

/** One line of plain words: no escapes, control characters, markdown marks or extra spaces. */
export function plainWords(text: string): string {
  return (
    text
      .replace(ANSI, '')
      // oxlint-disable-next-line no-control-regex -- removing control characters is the point
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[`*_#>|]+/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

const SENTENCES = /[^.!?]+(?:[.!?]+(?=\s|$)|$)/g

function sentencesOf(text: string): string[] {
  return (plainWords(text).match(SENTENCES) ?? []).map((s) => s.trim()).filter(Boolean)
}

/** The first sentence of a reply, as plain words. */
export function firstSentence(text: string): string {
  return sentencesOf(text)[0] ?? ''
}

/** The last sentence ending in "?", or null. */
export function lastQuestion(text: string): string | null {
  const questions = sentencesOf(text).filter((s) => s.endsWith('?'))
  return questions.at(-1) ?? null
}

export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

/** The agent's last reply if it was written after ADAM's message, else null. */
export function freshReply(read: ConductorRead | null, sentAt: number): string | null {
  const reply = read?.reply
  // Why the time check: a reply from before ADAM's message is the previous task's.
  return reply && (reply.at === null || reply.at >= sentAt) && reply.text.trim() ? reply.text : null
}

export function lastSentenceAsks(text: string): boolean {
  return sentencesOf(text).at(-1)?.endsWith('?') === true
}

/** "<label> says it's done: <first sentence>", short, never a secret. */
export function doneNotice(label: string, read: ConductorRead | null, sentAt: number): string {
  const fresh = freshReply(read, sentAt) ?? ''
  const sentence = fresh ? firstSentence(fresh) : ''
  if (!sentence) {
    return clip(`${label} looks finished, but I could not read what it said.`, CONDUCTOR_NOTICE_MAX_CHARS)
  }
  // Why the whole reply: a key past the first sentence would still be shown in part elsewhere.
  if (looksSecret(fresh) || looksSecret(sentence)) {
    return clip(
      `${label} says it's done. Its reply looked like it had a secret, so I left it out.`,
      CONDUCTOR_NOTICE_MAX_CHARS
    )
  }
  return clip(`${label} says it's done: ${sentence}`, CONDUCTOR_NOTICE_MAX_CHARS)
}

/** "<label> needs you: <question>", short, never a secret. */
export function needsYouNotice(
  label: string,
  read: ConductorRead | null,
  status: ConductorStatus['status'],
  sentAt: number
): string {
  const reply = freshReply(read, sentAt)
  // Why the whole reply: a question next to a key must not be shown.
  const fromReply = reply && !looksSecret(reply) ? lastQuestion(reply) : null
  const screenLine = read ? lastOutputLine(read.screen.filter((line) => line.includes('?'))) : null
  const question = fromReply ?? (screenLine ? plainWords(screenLine) : null)
  if (question && !looksSecret(question)) {
    return clip(`${label} needs you: ${question}`, CONDUCTOR_NOTICE_MAX_CHARS)
  }
  const generic =
    status === 'permission'
      ? `${label} needs you: it is waiting for your answer or a permission.`
      : `${label} needs you.`
  return clip(generic, CONDUCTOR_NOTICE_MAX_CHARS)
}

/**
 * A terminal's name as a notice may say it. Why the whole label is checked
 * before it is cut: a title can hold a key, and a cut one would still show part of it.
 */
export function safeLabel(label: string | null | undefined): string {
  const words = plainWords(label ?? '')
  if (!words || looksSecret(label ?? '') || looksSecret(words)) {
    return CONDUCTOR_LABEL_FALLBACK
  }
  return clip(words, LABEL_MAX_CHARS)
}

export type ConductorUpdate = { label: string; text: string }

/**
 * Updates as lines, never silently dropped: past `max`, the first max-1 stay
 * whole and the rest become one "And 3 more updates: A, B, C." line.
 */
export function summarizeUpdates(updates: ConductorUpdate[], max: number): string[] {
  if (updates.length <= max) {
    return updates.map((update) => update.text)
  }
  const kept = updates.slice(0, max - 1)
  const rest = updates.slice(max - 1)
  const names = [...new Set(rest.map((update) => update.label))]
  const shown = names.slice(0, 8).join(', ')
  const others = names.length > 8 ? ', and others' : ''
  return [...kept.map((update) => update.text), `And ${rest.length} more updates: ${shown}${others}.`]
}
