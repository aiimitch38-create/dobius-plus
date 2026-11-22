import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../speech/openai-api-key-store', () => ({
  hasOpenAiSpeechApiKey: () => false,
  readOpenAiSpeechApiKey: () => {
    throw new Error('the real key store must not be read in tests')
  }
}))

import {
  OPENAI_LIVE_API,
  createOpenAiLiveSession,
  isValidOfferSdp,
  testOpenAiLiveConnection
} from './openai-live-session'

// Fake value only.
const KEY = 'sk-fake-live-key-1234567890'
const OFFER =
  'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n'
const ANSWER =
  'v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n'
const OPTIONS = { voice: 'marin', idleTimeoutSec: 30 }

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>

function fetchReturning(response: () => Response): FetchMock {
  return vi.fn<typeof fetch>(async () => response())
}

function deps(fetchImpl: FetchMock, readKey: () => string = () => KEY) {
  return { hasKey: () => true, readKey, fetchImpl: fetchImpl as unknown as typeof fetch }
}

function errorResponse(status: number, error: Record<string, string>): () => Response {
  return () =>
    new Response(JSON.stringify({ error }), {
      status,
      headers: { 'content-type': 'application/json' }
    })
}

function loggedText(): string {
  return [console.warn, console.error, console.log]
    .flatMap((spy) => (spy as unknown as ReturnType<typeof vi.fn>).mock.calls)
    .map((call) => JSON.stringify(call))
    .join('\n')
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createOpenAiLiveSession', () => {
  it('posts the offer to the Live API and returns only the answer and session id', async () => {
    const fetchImpl = fetchReturning(
      () =>
        new Response(ANSWER, {
          status: 201,
          headers: { 'content-type': 'application/sdp', location: '/v1/live/sessions/sess_123' }
        })
    )

    const result = await createOpenAiLiveSession(OFFER, OPTIONS, deps(fetchImpl))

    expect(result).toEqual({ ok: true, answerSdp: ANSWER, sessionId: 'sess_123' })
    expect(JSON.stringify(result)).not.toContain(KEY)
    const [url, init] = fetchImpl.mock.calls[0] ?? []
    expect(url).toBe(OPENAI_LIVE_API.sessionsUrl)
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual({ Authorization: `Bearer ${KEY}` })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    const body = init?.body as FormData
    expect(body.get('sdp')).toBe(OFFER)
    expect(JSON.parse(String(body.get('session')))).toEqual({
      model: 'gpt-live-1.1',
      voice: 'marin',
      wake_policy: { type: 'speech' },
      idle_timeout_s: 30
    })
  })

  it('reads a JSON answer too', async () => {
    const fetchImpl = fetchReturning(
      () =>
        new Response(JSON.stringify({ id: 'sess_json', sdp: ANSWER }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    )
    expect(await createOpenAiLiveSession(OFFER, OPTIONS, deps(fetchImpl))).toEqual({
      ok: true,
      answerSdp: ANSWER,
      sessionId: 'sess_json'
    })
  })

  it('reads the key only when it creates a session', async () => {
    const readKey = vi.fn(() => KEY)
    const fetchImpl = fetchReturning(() => new Response(ANSWER, { status: 200 }))

    await createOpenAiLiveSession('not an offer', OPTIONS, deps(fetchImpl, readKey))
    expect(readKey).not.toHaveBeenCalled()

    await createOpenAiLiveSession(OFFER, OPTIONS, deps(fetchImpl, readKey))
    expect(readKey).toHaveBeenCalledOnce()
  })

  it.each([
    ['a non-string', 42],
    ['an empty string', ''],
    ['text that is not SDP', 'hello'],
    ['SDP with no media line', 'v=0\r\ns=-\r\n'],
    ['SDP with a null byte', `${OFFER}\u0000`],
    ['an oversized offer', `${OFFER}${'a=x\r\n'.repeat(30_000)}`]
  ])('refuses %s without calling OpenAI', async (_label, offer) => {
    const fetchImpl = fetchReturning(() => new Response(ANSWER, { status: 200 }))
    const result = await createOpenAiLiveSession(offer, OPTIONS, deps(fetchImpl))
    expect(result).toMatchObject({ ok: false, kind: 'invalid-offer' })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(isValidOfferSdp(offer)).toBe(false)
  })

  it.each([
    [{ voice: 'Marin; drop', idleTimeoutSec: 30 }],
    [{ voice: 'marin', idleTimeoutSec: 4 }],
    [{ voice: 'marin', idleTimeoutSec: 61 }],
    [{ voice: 'marin', idleTimeoutSec: 12.5 }]
  ])('refuses session options %j', async (options) => {
    const fetchImpl = fetchReturning(() => new Response(ANSWER, { status: 200 }))
    const result = await createOpenAiLiveSession(OFFER, options, deps(fetchImpl))
    expect(result.ok).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('says so when no key is saved', async () => {
    const fetchImpl = fetchReturning(() => new Response(ANSWER, { status: 200 }))
    const result = await createOpenAiLiveSession(OFFER, OPTIONS, {
      hasKey: () => false,
      readKey: () => KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch
    })
    expect(result).toMatchObject({ ok: false, kind: 'no-key' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('uses the real key store by default, which reports no key here', async () => {
    expect(await createOpenAiLiveSession(OFFER, OPTIONS)).toMatchObject({
      ok: false,
      kind: 'no-key'
    })
  })

  it('reports a key that cannot be decrypted', async () => {
    const fetchImpl = fetchReturning(() => new Response(ANSWER, { status: 200 }))
    const result = await createOpenAiLiveSession(
      OFFER,
      OPTIONS,
      deps(fetchImpl, () => {
        throw new Error('OpenAI API key could not be decrypted')
      })
    )
    expect(result).toMatchObject({ ok: false, kind: 'key-unreadable' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([
    [401, { message: `Incorrect API key provided: ${KEY}`, code: 'invalid_api_key' }, 'bad-key'],
    [403, { message: 'Forbidden', code: 'forbidden' }, 'no-access'],
    [
      404,
      { message: 'The model gpt-live-1.1 does not exist', code: 'model_not_found' },
      'no-access'
    ],
    [400, { message: 'No access to model', code: 'model_not_found' }, 'no-access'],
    [429, { message: 'You exceeded your current quota', code: 'insufficient_quota' }, 'no-billing'],
    [429, { message: 'Slow down', code: 'rate_limit_exceeded' }, 'rate-limited'],
    [503, { message: 'Overloaded', code: 'server_error' }, 'server'],
    [400, { message: 'Unknown parameter: wake_policy', code: 'invalid_request_error' }, 'rejected']
  ])('maps HTTP %i %j to %s', async (status, error, kind) => {
    const fetchImpl = fetchReturning(errorResponse(status, error))
    const result = await createOpenAiLiveSession(OFFER, OPTIONS, deps(fetchImpl))
    expect(result).toMatchObject({ ok: false, kind })
    expect(JSON.stringify(result)).not.toContain(KEY)
    expect(loggedText()).not.toContain(KEY)
  })

  it('never passes on a key or a masked key from an error message', async () => {
    const fetchImpl = fetchReturning(
      errorResponse(400, {
        message: `Bad request made with ${KEY} (also shown as sk-fak***890)`,
        code: 'invalid_request_error'
      })
    )
    const result = await createOpenAiLiveSession(OFFER, OPTIONS, deps(fetchImpl))
    expect(result).toMatchObject({ ok: false, kind: 'rejected' })
    expect(JSON.stringify(result)).not.toContain('sk-')
    expect(loggedText()).not.toContain('sk-')
  })

  it('reports a timeout', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        })
    )
    const result = await createOpenAiLiveSession(OFFER, OPTIONS, {
      ...deps(fetchImpl),
      timeoutMs: 20
    })
    expect(result).toMatchObject({ ok: false, kind: 'timeout' })
  })

  it('reports a network failure without leaking the thrown text', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError(`fetch failed for Bearer ${KEY}`)
    })
    const result = await createOpenAiLiveSession(OFFER, OPTIONS, deps(fetchImpl))
    expect(result).toMatchObject({ ok: false, kind: 'network' })
    expect(JSON.stringify(result)).not.toContain(KEY)
    expect(loggedText()).not.toContain(KEY)
  })

  it('refuses an answer that is not SDP or that echoes the key', async () => {
    const notSdp = fetchReturning(() => new Response('<html>', { status: 200 }))
    expect(await createOpenAiLiveSession(OFFER, OPTIONS, deps(notSdp))).toMatchObject({
      ok: false,
      kind: 'bad-response'
    })
    const echo = fetchReturning(() => new Response(`${ANSWER}a=x:${KEY}\r\n`, { status: 200 }))
    const result = await createOpenAiLiveSession(OFFER, OPTIONS, deps(echo))
    expect(result).toMatchObject({ ok: false, kind: 'bad-response' })
    expect(JSON.stringify(result)).not.toContain(KEY)
  })
})

describe('testOpenAiLiveConnection', () => {
  it('passes when OpenAI opens a session', async () => {
    const fetchImpl = fetchReturning(() => new Response(ANSWER, { status: 200 }))
    const result = await testOpenAiLiveConnection(OPTIONS, deps(fetchImpl))
    expect(result.ok).toBe(true)
    expect(JSON.stringify(result)).not.toContain(KEY)
    expect(JSON.stringify(result)).not.toContain('v=0')
  })

  it('passes when only the placeholder offer is turned down', async () => {
    const fetchImpl = fetchReturning(
      errorResponse(400, { message: 'Invalid SDP offer', code: 'invalid_request_error' })
    )
    expect((await testOpenAiLiveConnection(OPTIONS, deps(fetchImpl))).ok).toBe(true)
  })

  it.each([
    [401, { message: 'Incorrect API key', code: 'invalid_api_key' }, 'bad-key'],
    [404, { message: 'No such model', code: 'model_not_found' }, 'no-access'],
    [400, { message: 'Unknown parameter: voice', code: 'invalid_request_error' }, 'rejected']
  ])('fails on HTTP %i %j as %s', async (status, error, kind) => {
    const fetchImpl = fetchReturning(errorResponse(status, error))
    expect(await testOpenAiLiveConnection(OPTIONS, deps(fetchImpl))).toMatchObject({
      ok: false,
      kind
    })
  })

  it('fails in plain English when no key is saved', async () => {
    const result = await testOpenAiLiveConnection(OPTIONS)
    expect(result).toMatchObject({ ok: false, kind: 'no-key' })
    expect(result.ok === false && result.error).toContain('No OpenAI API key is saved')
  })
})
