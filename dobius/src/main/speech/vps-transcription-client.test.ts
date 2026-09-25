import { describe, expect, it, vi, afterEach } from 'vitest'

import {
  DEFAULT_VPS_STT_ENDPOINT,
  VpsTranscriptionSession,
  checkVpsSttHealth,
  describeVpsTranscriptionFailure,
  resolveVpsSttEndpoint,
} from './vps-transcription-client'

afterEach(() => {
  vi.unstubAllGlobals()
})

const SR = 16000

function tone(seconds: number): Float32Array {
  return new Float32Array(SR * seconds).fill(0.1)
}

describe('describeVpsTranscriptionFailure', () => {
  it('names Tailscale for unreachable-host errors, since that is the usual cause', () => {
    const msg = describeVpsTranscriptionFailure(new Error('fetch failed'), 'http://x:1')
    expect(msg).toContain('Tailscale')
    expect(msg).toContain('http://x:1')
  })

  it('distinguishes a timeout from an unreachable host', () => {
    const msg = describeVpsTranscriptionFailure(new Error('The operation was aborted'), 'http://x:1')
    expect(msg).toContain('timed out')
    expect(msg).not.toContain('Tailscale')
  })
})

describe('VpsTranscriptionSession', () => {
  it('returns empty string without calling the server when no audio was fed', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await new VpsTranscriptionSession().finish()).toBe('')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts a WAV to /transcribe and returns the transcript', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ text: 'Hello, world.' }),
    }))
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const session = new VpsTranscriptionSession('http://server:8823/')
    session.feedAudio(tone(1), SR)
    expect(await session.finish()).toBe('Hello, world.')

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    // Trailing slash on the endpoint must not produce a double slash.
    expect(url).toBe('http://server:8823/transcribe')
    expect(init.method).toBe('POST')
    // RIFF magic proves we sent a real WAV, not raw samples.
    expect(Buffer.from(init.body as Uint8Array).subarray(0, 4).toString()).toBe('RIFF')
  })

  it('surfaces a server error body rather than a bare status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: 'not a readable WAV' }),
      })) as unknown as typeof fetch,
    )
    const session = new VpsTranscriptionSession()
    session.feedAudio(tone(1), SR)
    await expect(session.finish()).rejects.toThrow('not a readable WAV')
  })

  it('rejects dictations longer than the 10 minute cap', () => {
    const session = new VpsTranscriptionSession()
    expect(() => {
      for (let i = 0; i < 11; i += 1) {
        session.feedAudio(tone(60), SR)
      }
    }).toThrow('10 minutes')
  })

  it('defaults to the Tailscale endpoint', () => {
    expect(DEFAULT_VPS_STT_ENDPOINT).toBe('http://100.98.24.1:8823')
  })
})

describe('resolveVpsSttEndpoint (#123)', () => {
  it('uses the configured endpoint over the default', () => {
    expect(resolveVpsSttEndpoint(' https://stt.example.com:9000 ')).toBe(
      'https://stt.example.com:9000',
    )
  })

  it('falls back to the default only when nothing is configured', () => {
    expect(resolveVpsSttEndpoint(undefined)).toBe(DEFAULT_VPS_STT_ENDPOINT)
    expect(resolveVpsSttEndpoint('   ')).toBe(DEFAULT_VPS_STT_ENDPOINT)
  })

  it('rejects a malformed endpoint instead of silently using the default host', () => {
    expect(() => resolveVpsSttEndpoint('stt.example.com:9000')).toThrow('Speech server address')
    expect(() => resolveVpsSttEndpoint('not a url')).toThrow('not a valid URL')
    expect(() => resolveVpsSttEndpoint('file:///etc/passwd')).toThrow('http:// or https://')
    expect(() => resolveVpsSttEndpoint('http://user:pw@host:1')).toThrow('http:// or https://')
  })
})

describe('VpsTranscriptionSession timeouts (#84 VPS path)', () => {
  it('times out when the response body never finishes', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, init: RequestInit) => ({
          ok: true,
          status: 200,
          json: () =>
            new Promise((_resolve, reject) => {
              init.signal?.addEventListener('abort', () => {
                reject(new DOMException('This operation was aborted', 'AbortError'))
              })
            }),
        })) as unknown as typeof fetch,
      )
      const session = new VpsTranscriptionSession('http://server:8823')
      session.feedAudio(tone(1), SR)

      const outcome = session.finish().then(
        () => 'resolved',
        (error: Error) => error.message,
      )
      await vi.advanceTimersByTimeAsync(120_000)
      expect(await Promise.race([outcome, Promise.resolve('pending')])).toBe(
        'Speech server at http://server:8823 timed out. It may still be loading the model.',
      )
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('endpoint credential redaction', () => {
  it('never echoes a password from a rejected endpoint', () => {
    for (const endpoint of [
      'http://carson:s3cretPw@host:1',
      'ftp://carson:s3cretPw@host:1',
      'carson:s3cretPw@host:1',
      'http://carson:s3cretPw@bad host',
    ]) {
      let message = ''
      try {
        resolveVpsSttEndpoint(endpoint)
      } catch (error) {
        message = (error as Error).message
      }
      expect(message).toContain('Speech server address')
      expect(message).not.toContain('s3cretPw')
      expect(message).not.toContain('carson')
    }
  })

  it('never echoes a password through transport failure messages', () => {
    const endpoint = 'http://carson:s3cretPw@host:1'
    for (const raw of [
      'fetch failed',
      'The operation was aborted',
      `Request cannot be constructed from a URL that includes credentials: ${endpoint}/transcribe`,
    ]) {
      const message = describeVpsTranscriptionFailure(new Error(raw), endpoint)
      expect(message).not.toContain('s3cretPw')
    }
  })
})

describe('checkVpsSttHealth', () => {
  it('reports false instead of throwing when the server is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('fetch failed')
      }) as unknown as typeof fetch,
    )
    await expect(checkVpsSttHealth()).resolves.toBe(false)
  })

  it('reports true when the server answers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })) as unknown as typeof fetch)
    await expect(checkVpsSttHealth()).resolves.toBe(true)
  })
})
