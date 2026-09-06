import { describe, expect, it, vi, afterEach } from 'vitest'

import {
  DEFAULT_VPS_STT_ENDPOINT,
  VpsTranscriptionSession,
  checkVpsSttHealth,
  describeVpsTranscriptionFailure,
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
