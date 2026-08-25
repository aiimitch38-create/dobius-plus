export const WAKE_WORD_WINDOW_MS = 12_000

// Why anchored: the phrase must START a final transcript so mid-sentence
// mentions of Adam in dictated prose never trigger a send.
const WAKE_PHRASE = /^\s*hey[, ]*adam\b/i
const TRAILING_SEPARATORS = /^[\s,.!?;:]+/

export type WakeWordMatcher = {
  /** Returns the utterance to ask ADAM, or null when nothing fired yet. */
  feed(transcript: string): string | null
  reset(): void
}

/**
 * Pure "Hey Adam" detector over STT final transcripts.
 *
 * Semantics: a transcript starting with the wake phrase arms the matcher; any
 * remainder after the phrase is the utterance and fires immediately (matcher
 * stays armed for follow-ups inside the window). If the wake phrase arrives
 * alone, the next non-empty final within WAKE_WORD_WINDOW_MS becomes the
 * utterance, and firing disarms until the next wake phrase. Empty finals while
 * armed are ignored (STT sometimes emits blank finals) rather than consuming
 * the arm.
 */
export function createWakeWordMatcher(
  options: { now?: () => number; windowMs?: number } = {}
): WakeWordMatcher {
  const now = options.now ?? Date.now
  const windowMs = options.windowMs ?? WAKE_WORD_WINDOW_MS
  let armedAt: number | null = null

  return {
    feed(transcript: string): string | null {
      const text = typeof transcript === 'string' ? transcript : ''
      if (!text.trim()) {
        return null
      }

      const wakeMatch = WAKE_PHRASE.exec(text)
      if (wakeMatch) {
        armedAt = now()
        const remainder = text.slice(wakeMatch[0].length).replace(TRAILING_SEPARATORS, '').trim()
        return remainder.length > 0 ? remainder : null
      }

      if (armedAt === null) {
        return null
      }

      if (now() - armedAt > windowMs) {
        armedAt = null
        return null
      }

      armedAt = null
      return text.trim()
    },
    reset(): void {
      armedAt = null
    }
  }
}
