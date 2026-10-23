export type BoardMentionTarget = { id: string; name: string }

export type BoardMention = { target: BoardMentionTarget; message: string }

const normalize = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, '-')

/**
 * "@Reviewer fix the tests" → the Reviewer target + "fix the tests". Names with
 * spaces match with spaces or dashes ("@code-reviewer" hits "Code reviewer").
 * Longest name wins so "@Reviewer 2" isn't captured by "Reviewer".
 */
export function parseBoardMention(
  text: string,
  targets: readonly BoardMentionTarget[]
): BoardMention | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('@')) {
    return null
  }
  const body = trimmed.slice(1)
  const lowered = body.toLowerCase()
  const candidates = [...targets].sort((a, b) => b.name.length - a.name.length)
  for (const target of candidates) {
    const name = target.name.trim()
    if (!name) {
      continue
    }
    for (const spelling of [name.toLowerCase(), normalize(name)]) {
      if (!lowered.startsWith(spelling)) {
        continue
      }
      const rest = body.slice(spelling.length)
      if (rest !== '' && !/^[\s,:]/.test(rest)) {
        continue
      }
      const message = rest.replace(/^[\s,:]+/, '').trim()
      return message ? { target, message } : null
    }
  }
  return null
}
