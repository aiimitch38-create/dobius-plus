/**
 * One shared definition of "a spoken sentence ends here", used by both
 * `chunkForSpeech` (ElevenLabs path) and the streaming voice brain. Pure —
 * no I/O, no timers — so the whole streaming pipeline is unit-testable.
 */

/**
 * Index just past the LAST complete sentence in `text`, or -1 when none.
 * A sentence ends at '.', '!' or '?' followed by whitespace, or at a newline.
 */
export function lastSentenceEnd(text: string): number {
  let end = -1
  for (let i = 0; i < text.length - 1; i += 1) {
    const ch = text[i]
    if (ch === '\n') {
      end = i + 1
    } else if ((ch === '.' || ch === '!' || ch === '?') && /\s/.test(text[i + 1])) {
      end = i + 1
    }
  }
  if (text.endsWith('\n')) {
    end = text.length
  }
  return end
}

export type SentenceSplitter = {
  /** Feed a streamed delta; returns any sentences completed by it. */
  push(delta: string): string[]
  /** Returns the unterminated tail (end of stream), or null when empty. */
  flush(): string | null
}

export function createSentenceSplitter(): SentenceSplitter {
  let buffer = ''
  return {
    push(delta: string): string[] {
      buffer += delta
      const end = lastSentenceEnd(buffer)
      if (end < 0) {
        return []
      }
      const complete = buffer.slice(0, end)
      buffer = buffer.slice(end)
      return complete
        .split('\n')
        .flatMap(splitTerminated)
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    },
    flush(): string | null {
      const tail = buffer.trim()
      buffer = ''
      return tail.length > 0 ? tail : null
    }
  }
}

/** Splits a run of terminated sentences ("A. B! C?") into its parts. */
function splitTerminated(text: string): string[] {
  const parts: string[] = []
  let start = 0
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if ((ch === '.' || ch === '!' || ch === '?') && (i + 1 >= text.length || /\s/.test(text[i + 1]))) {
      parts.push(text.slice(start, i + 1))
      start = i + 1
    }
  }
  if (start < text.length) {
    parts.push(text.slice(start))
  }
  return parts
}
