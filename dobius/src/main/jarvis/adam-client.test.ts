import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ADAM_CONVERSE_TIMEOUT_MS,
  ADAM_UNREACHABLE_TEXT,
  adamServiceTokenPath,
  converseWithAdam,
  loadAdamServiceToken,
  parseAdamConverseResponse,
  resetAdamServiceTokenCacheForTests
} from './adam-client'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status })
}

afterEach(() => {
  resetAdamServiceTokenCacheForTests()
  vi.useRealTimers()
  delete process.env.DOBIUS_ADAM_TOKEN_PATH
})

describe('parseAdamConverseResponse', () => {
  it('parses a successful answer', () => {
    expect(
      parseAdamConverseResponse({ ok: true, result: { kind: 'answer', text: 'All systems go' } })
    ).toEqual({ kind: 'answer', text: 'All systems go' })
  })

  it('parses a job result with an optional jobId', () => {
    expect(
      parseAdamConverseResponse({
        ok: true,
        result: { kind: 'job', text: 'Working on it', jobId: 'job-9' }
      })
    ).toEqual({ kind: 'job', text: 'Working on it', jobId: 'job-9' })
    expect(parseAdamConverseResponse({ ok: true, result: { kind: 'job', text: 'On it' } })).toEqual(
      { kind: 'job', text: 'On it' }
    )
  })

  it('rejects malformed payloads as unreadable', () => {
    const unreadable = { kind: 'error', text: 'ADAM sent an unreadable response' }
    expect(parseAdamConverseResponse(null)).toEqual(unreadable)
    expect(parseAdamConverseResponse({ ok: false })).toEqual(unreadable)
    expect(parseAdamConverseResponse({ ok: true, result: {} })).toEqual(unreadable)
    expect(
      parseAdamConverseResponse({ ok: true, result: { kind: 'weird', text: 'x' } })
    ).toEqual(unreadable)
  })
})

describe('converseWithAdam', () => {
  const args = { token: 'tok-1', utterance: 'what is running today' }

  it('POSTs JSON with a bearer token to the /v1/converse endpoint', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ok: true, result: { kind: 'answer', text: 'hi' } }))
    await converseWithAdam({ ...args, endpoint: 'http://127.0.0.1:8791///', fetchFn })
    expect(fetchFn).toHaveBeenCalledWith('http://127.0.0.1:8791/v1/converse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-1' },
      body: JSON.stringify({ utterance: 'what is running today' }),
      signal: expect.any(AbortSignal)
    })
  })

  it('returns the parsed answer on success', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ok: true, result: { kind: 'answer', text: 'two PRs open' } }))
    await expect(converseWithAdam({ ...args, fetchFn })).resolves.toEqual({
      kind: 'answer',
      text: 'two PRs open'
    })
  })

  it('maps network failures to the unreachable error', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(converseWithAdam({ ...args, fetchFn })).resolves.toEqual({
      kind: 'error',
      text: ADAM_UNREACHABLE_TEXT
    })
  })

  it('maps non-2xx HTTP responses to the unreachable error', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ message: 'unauthorized' }, 401))
    await expect(converseWithAdam({ ...args, fetchFn })).resolves.toEqual({
      kind: 'error',
      text: ADAM_UNREACHABLE_TEXT
    })
  })

  it('times out after the configured window and reports unreachable', async () => {
    vi.useFakeTimers()
    const neverResponds = (_url: URL | RequestInfo, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    const pending = converseWithAdam({ ...args, fetchFn: neverResponds })
    void pending.catch(() => undefined)
    await vi.advanceTimersByTimeAsync(ADAM_CONVERSE_TIMEOUT_MS + 1)
    await expect(pending).resolves.toEqual({ kind: 'error', text: ADAM_UNREACHABLE_TEXT })
  })

  it('reports unreadable when the body is not JSON', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('<html>gateway error</html>', { status: 200 }))
    await expect(converseWithAdam({ ...args, fetchFn })).resolves.toEqual({
      kind: 'error',
      text: 'ADAM sent an unreadable response'
    })
  })
})

describe('loadAdamServiceToken', () => {
  it('reads once and caches across calls', () => {
    let reads = 0
    const reader = (): string => {
      reads += 1
      return ' secret-token \n'
    }
    expect(loadAdamServiceToken(reader)).toBe('secret-token')
    expect(loadAdamServiceToken(reader)).toBe('secret-token')
    expect(reads).toBe(1)
  })

  it('falls back to an empty token when the file is missing', () => {
    expect(loadAdamServiceToken(() => {
      throw new Error('ENOENT')
    })).toBe('')
  })

  it('honors DOBIUS_ADAM_TOKEN_PATH over the machine default', () => {
    process.env.DOBIUS_ADAM_TOKEN_PATH = '/custom/path/service-token'
    expect(adamServiceTokenPath()).toBe('/custom/path/service-token')
  })
})
