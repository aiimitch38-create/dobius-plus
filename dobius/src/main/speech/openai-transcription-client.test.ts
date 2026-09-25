import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OPENAI_TRANSCRIPTION_TIMEOUT_MS,
  OpenAiTranscriptionSession,
  sanitizeOpenAiTranscriptionErrorMessage
} from './openai-transcription-client'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const SR = 16000

function tone(seconds: number): Float32Array {
  return new Float32Array(SR * seconds).fill(0.1)
}

/** A fetch that never answers on its own; like real fetch, it rejects on abort. */
function hangingFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('This operation was aborted', 'AbortError'))
        })
      })
  )
}

describe('sanitizeOpenAiTranscriptionErrorMessage', () => {
  it('does not expose the invalid OpenAI API key echoed by the provider', () => {
    expect(
      sanitizeOpenAiTranscriptionErrorMessage(
        'Incorrect API key provided: fsdfdsfsdf. You can find your API key at https://platform.openai.com/account/api-keys.'
      )
    ).toBe('Incorrect OpenAI API key provided.')
  })

  it('redacts API keys and bearer tokens from other provider errors', () => {
    expect(
      sanitizeOpenAiTranscriptionErrorMessage(
        'Request failed for sk-testSecret123 with Authorization: Bearer token-value_123'
      )
    ).toBe('Request failed for [redacted] with Authorization: Bearer [redacted]')
  })
})

describe('OpenAiTranscriptionSession', () => {
  it('times out a transcription request that never responds (#84)', async () => {
    vi.useFakeTimers()
    const fetchMock = hangingFetch()
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    const session = new OpenAiTranscriptionSession('openai-gpt-4o-mini-transcribe', () => 'key')
    session.feedAudio(tone(1), SR)

    const outcome = session.finish().then(
      () => 'resolved',
      (error: Error) => error.message
    )
    await vi.advanceTimersByTimeAsync(OPENAI_TRANSCRIPTION_TIMEOUT_MS - 1)
    expect(await Promise.race([outcome, Promise.resolve('pending')])).toBe('pending')

    await vi.advanceTimersByTimeAsync(1)
    expect(await Promise.race([outcome, Promise.resolve('pending')])).toBe(
      'OpenAI transcription timed out after 120 seconds'
    )
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('times out when the response body never finishes (#84)', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              reject(new DOMException('This operation was aborted', 'AbortError'))
            })
          })
      })) as unknown as typeof fetch
    )
    const session = new OpenAiTranscriptionSession('openai-gpt-4o-mini-transcribe', () => 'key')
    session.feedAudio(tone(1), SR)

    const outcome = session.finish().then(
      () => 'resolved',
      (error: Error) => error.message
    )
    await vi.advanceTimersByTimeAsync(OPENAI_TRANSCRIPTION_TIMEOUT_MS)
    expect(await Promise.race([outcome, Promise.resolve('pending')])).toBe(
      'OpenAI transcription timed out after 120 seconds'
    )
  })

  it('still transcribes the accepted 10 minutes after rejecting audio past the cap (#85)', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ text: 'ten minutes' })
    }))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    const session = new OpenAiTranscriptionSession('openai-gpt-4o-mini-transcribe', () => 'key')
    for (let i = 0; i < 10; i += 1) {
      session.feedAudio(tone(60), SR)
    }
    expect(() => session.feedAudio(tone(1), SR)).toThrow('10 minutes')

    expect(await session.finish()).toBe('ten minutes')
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const file = (init.body as FormData).get('file') as Blob
    // 44-byte WAV header + exactly 600 s of 16 kHz PCM16.
    expect(file.size).toBe(44 + 600 * SR * 2)
  })
})
