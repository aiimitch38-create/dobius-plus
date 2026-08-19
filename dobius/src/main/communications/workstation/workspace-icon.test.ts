import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchWorkspaceIcon } from './workspace-icon'

describe('fetchWorkspaceIcon', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('fetches the NIP-11 icon field over http(s), converting ws(s):// relay URLs', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ icon: 'data:image/png;base64,AAAA' })
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const icon = await fetchWorkspaceIcon('wss://relay.example.com')
    expect(icon).toBe('data:image/png;base64,AAAA')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://relay.example.com/',
      expect.objectContaining({ headers: { Accept: 'application/nostr+json' } })
    )
  })

  it('returns null for an unreachable relay instead of throwing', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch
    expect(await fetchWorkspaceIcon('wss://unreachable.example.com')).toBeNull()
  })

  it('returns null when the document has no icon field', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as unknown as typeof fetch
    expect(await fetchWorkspaceIcon('wss://relay.example.com')).toBeNull()
  })

  it('returns null for a malformed relay URL rather than throwing', async () => {
    expect(await fetchWorkspaceIcon('not a url')).toBeNull()
  })
})
