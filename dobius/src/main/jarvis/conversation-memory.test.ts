import { describe, expect, it, vi } from 'vitest'
import { fetchRecentConversationSummaries, formatConversationMemory } from './conversation-memory'

function fakeFetch(list: unknown, byId: Record<string, unknown>): typeof fetch {
  return vi.fn(async (input: unknown) => {
    const url = String(input)
    const match = /conversations\/([^?]+)$/.exec(url)
    const body = match ? byId[match[1]] : list
    return new Response(JSON.stringify(body ?? {}), { status: 200 })
  }) as unknown as typeof fetch
}

describe('fetchRecentConversationSummaries', () => {
  it('returns summaries newest first', async () => {
    const impl = fakeFetch(
      { conversations: [{ conversation_id: 'a' }, { conversation_id: 'b' }] },
      {
        a: { analysis: { transcript_summary: 'talked about disk space' } },
        b: { analysis: { transcript_summary: 'talked about the orb' } }
      }
    )
    expect(await fetchRecentConversationSummaries('k', 'agent', 3, impl)).toEqual([
      'talked about disk space',
      'talked about the orb'
    ])
  })

  it('skips conversations with no summary', async () => {
    const impl = fakeFetch({ conversations: [{ conversation_id: 'a' }] }, { a: { analysis: {} } })
    expect(await fetchRecentConversationSummaries('k', 'agent', 3, impl)).toEqual([])
  })

  it('returns nothing without a key or agent', async () => {
    const impl = fakeFetch({}, {})
    expect(await fetchRecentConversationSummaries('', 'agent', 3, impl)).toEqual([])
    expect(await fetchRecentConversationSummaries('k', '', 3, impl)).toEqual([])
  })
})

describe('formatConversationMemory', () => {
  it('is empty when there is nothing to remember', () => {
    expect(formatConversationMemory([])).toBe('')
  })

  it('numbers the summaries', () => {
    expect(formatConversationMemory(['one', 'two'])).toContain('1. one')
  })
})
