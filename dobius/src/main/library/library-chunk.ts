import type { LibrarySection } from './library-types'

export const CHUNK_TARGET_CHARS = 1500
export const CHUNK_MAX_CHARS = 2000
/** Why: one runaway transcript must not fill the cap on its own. */
export const DOCUMENT_MAX_CHARS = 2_000_000

/** Split one long block on paragraph, then line, then word boundaries. */
function splitLong(text: string, max: number): string[] {
  if (text.length <= max) {
    return [text]
  }
  const pieces: string[] = []
  let rest = text
  while (rest.length > max) {
    const window = rest.slice(0, max)
    let cut = window.lastIndexOf('\n\n')
    if (cut < max / 2) {
      cut = window.lastIndexOf('\n')
    }
    if (cut < max / 2) {
      cut = window.lastIndexOf(' ')
    }
    if (cut < max / 2) {
      cut = max
    }
    pieces.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) {
    pieces.push(rest)
  }
  return pieces.filter((piece) => piece.length > 0)
}

/**
 * Sections packed into ~1.5k chunks (never over 2k). A chunk carries the time
 * of its first section, so a hit in a long conversation dates the passage,
 * not the whole session.
 */
export function chunkSections(sections: LibrarySection[]): LibrarySection[] {
  const chunks: LibrarySection[] = []
  let text = ''
  let at = 0
  let total = 0
  const flush = (): void => {
    if (text.trim()) {
      chunks.push({ text: text.trim(), at })
    }
    text = ''
  }
  for (const section of sections) {
    if (total >= DOCUMENT_MAX_CHARS) {
      break
    }
    const body = section.text.trim()
    if (!body) {
      continue
    }
    total += body.length
    for (const piece of splitLong(body, CHUNK_MAX_CHARS)) {
      if (text && text.length + piece.length + 2 > CHUNK_TARGET_CHARS) {
        flush()
      }
      if (!text) {
        at = section.at
      }
      text = text ? `${text}\n\n${piece}` : piece
    }
  }
  flush()
  return chunks
}

/** A short title from free text: first line, cut at about 80 characters. */
export function titleFrom(text: string, fallback: string): string {
  const line = text
    .split('\n')
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .find((value) => value.length > 0)
  if (!line) {
    return fallback
  }
  return line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line
}
