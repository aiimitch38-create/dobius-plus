const API = 'https://api.elevenlabs.io/v1/convai/conversations'

type ConversationListItem = { conversation_id?: unknown; start_time_unix_secs?: unknown }

/**
 * Summaries of the last few calls, so Adam remembers what was already
 * discussed instead of relying on undocumented platform behaviour.
 *
 * ponytail: N+1 requests (list, then each conversation). Fine for 3 items
 * fetched off the critical path; batch if the count ever grows.
 */
export async function fetchRecentConversationSummaries(
  apiKey: string,
  agentId: string,
  limit = 3,
  fetchImpl: typeof fetch = fetch
): Promise<string[]> {
  if (!apiKey.trim() || !agentId.trim()) {
    return []
  }
  const headers = { 'xi-api-key': apiKey.trim() }
  let ids: string[]
  try {
    const listed = await fetchImpl(
      `${API}?agent_id=${encodeURIComponent(agentId)}&page_size=${limit}`,
      { headers, signal: AbortSignal.timeout(10_000) }
    )
    if (!listed.ok) {
      return []
    }
    const payload = (await listed.json()) as { conversations?: ConversationListItem[] }
    ids = (payload.conversations ?? [])
      .map((item) => (typeof item.conversation_id === 'string' ? item.conversation_id : null))
      .filter((id): id is string => id !== null)
      .slice(0, limit)
  } catch {
    return []
  }

  const summaries = await Promise.all(
    ids.map(async (id) => {
      try {
        const response = await fetchImpl(`${API}/${encodeURIComponent(id)}`, {
          headers,
          signal: AbortSignal.timeout(10_000)
        })
        if (!response.ok) {
          return null
        }
        const body = (await response.json()) as {
          analysis?: { transcript_summary?: unknown }
        }
        const summary = body.analysis?.transcript_summary
        return typeof summary === 'string' && summary.trim() ? summary.trim() : null
      } catch {
        return null
      }
    })
  )
  return summaries.filter((summary): summary is string => summary !== null)
}

export function formatConversationMemory(summaries: string[]): string {
  if (summaries.length === 0) {
    return ''
  }
  return [
    'What you and the user already discussed in recent calls (most recent first).',
    'Treat this as your own memory — do not say you were told it.',
    '',
    ...summaries.map((summary, index) => `${index + 1}. ${summary}`)
  ].join('\n')
}
