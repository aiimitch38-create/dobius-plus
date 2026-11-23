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
