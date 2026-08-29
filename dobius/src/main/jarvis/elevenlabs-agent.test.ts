import { describe, expect, it, vi } from 'vitest'
import { fetchAgentSignedUrl } from './elevenlabs-agent'

const ok = (body: unknown): typeof fetch =>
  vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch

describe('fetchAgentSignedUrl', () => {
  it('returns the signed url', async () => {
    expect(await fetchAgentSignedUrl('k', 'a', ok({ signed_url: 'wss://x' }))).toEqual({
      ok: true,
      url: 'wss://x'
    })
  })

  it('refuses without a key or agent id', async () => {
    expect((await fetchAgentSignedUrl('', 'a', ok({}))).ok).toBe(false)
    expect((await fetchAgentSignedUrl('k', '  ', ok({}))).ok).toBe(false)
  })

  it('explains a 401 as a missing permission', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 401 })) as unknown as typeof fetch
    const result = await fetchAgentSignedUrl('k', 'a', fetchImpl)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('convai_write')
  })

  it('fails cleanly when the body has no signed_url', async () => {
    expect((await fetchAgentSignedUrl('k', 'a', ok({ nope: 1 }))).ok).toBe(false)
  })
})
