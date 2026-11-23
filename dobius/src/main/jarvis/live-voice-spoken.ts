import type { JarvisAskResult } from '../../shared/speech-types'

// What the live voice may say out loud, shared by ADAM's answers and the quick hands.

// Why ~900 characters: the Live API caps session.commentary.append at 500
// tokens (design doc section 1.3). 900 characters is roughly 225 tokens, which
// leaves room for the model's own wrapping and is about 45 seconds of speech.
export const LIVE_SPOKEN_MAX_CHARS = 900

/**
 * ADAM's reply, made fit to be spoken: no code, no markdown, no raw links,
 * and short enough for one commentary event. The full reply stays in the thread.
 */
export function speakableReply(text: string): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, ' (the code is in the thread) ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/[*_~|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (plain.length <= LIVE_SPOKEN_MAX_CHARS) {
    return plain
  }
  const tail = ' The rest is in the thread.'
  const budget = LIVE_SPOKEN_MAX_CHARS - tail.length
  const cut = plain.slice(0, budget)
  const sentenceEnd = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '))
  const kept = sentenceEnd > budget / 3 ? cut.slice(0, sentenceEnd + 1) : `${cut.trimEnd()}…`
  return `${kept}${tail}`
}

// Why a lead-in, not a setting on the session: the voice paraphrases every
// commentary by default; this asks for one answer to be said as written.
export const LIVE_WORD_FOR_WORD_LEAD = "Say ADAM's answer to Carson exactly as written, word for word: "

/** What the voice says for ADAM's result; `wordForWord` asks it not to paraphrase. */
export function spokenFor(result: JarvisAskResult, wordForWord: boolean): string {
  if (result.kind === 'cancelled') {
    return ''
  }
  const spoken = speakableReply(result.text)
  return wordForWord && result.kind === 'answer' && spoken ? LIVE_WORD_FOR_WORD_LEAD + spoken : spoken
}
