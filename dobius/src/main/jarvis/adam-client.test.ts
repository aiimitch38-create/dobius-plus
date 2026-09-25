import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ADAM_BLOCKED_ENDPOINT_TEXT,
  ADAM_CONVERSE_TIMEOUT_MS,
  ADAM_NOT_INSTALLED_TEXT,
  ADAM_UNREACHABLE_TEXT,
  askAdam,
  converseWithAdam,
  parseAdamConverseResponse
} from './adam-client'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status })
}

const ENV_KEYS = [
  'ADAM_SERVICE_URL',
  'ADAM_SERVICE_TOKEN',
  'ADAM_SERVICE_TOKEN_PATH',
  'DOBIUS_ADAM_TOKEN_PATH',
  'DOBIUS_ADAM_PROJECT_DIR'
]
const savedEnv: Record<string, string | undefined> = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]])
)
const tempDirs: string[] = []

afterEach(() => {
  vi.useRealTimers()
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = savedEnv[key]
    }
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
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

describe('askAdam (#81, #118)', () => {
  function isolate(): string {
    for (const key of ENV_KEYS) {
      delete process.env[key]
    }
    const root = mkdtempSync(join(tmpdir(), 'adam-client-'))
    tempDirs.push(root)
    return root
  }

  function answer(): Response {
    return jsonResponse({ ok: true, result: { kind: 'answer', text: 'ok' } })
  }

  it('reports ADAM as not installed, without a request, when its folder is missing', async () => {
    const root = isolate()
    process.env.DOBIUS_ADAM_PROJECT_DIR = join(root, 'missing-adam')
    const fetchFn = vi.fn()
    await expect(
      askAdam({ settingsEndpoint: 'http://localhost:8791', utterance: 'hi', fetchFn })
    ).resolves.toEqual({ kind: 'error', text: ADAM_NOT_INSTALLED_TEXT })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('picks up a changed endpoint and a rotated token on the next ask, no restart', async () => {
    const root = isolate()
    const adamDir = join(root, 'ADAM')
    const tokenFile = join(adamDir, 'service', 'data', 'service-token')
    mkdirSync(join(adamDir, 'service', 'data'), { recursive: true })
    process.env.DOBIUS_ADAM_PROJECT_DIR = adamDir
    writeFileSync(tokenFile, 'fake-one\n')
    const fetchFn = vi.fn().mockImplementation(async () => answer())

    await askAdam({ settingsEndpoint: 'http://127.0.0.1:9001/', utterance: 'hi', fetchFn })
    writeFileSync(tokenFile, 'fake-two\n')
    await askAdam({ settingsEndpoint: 'http://localhost:9002', utterance: 'hi', fetchFn })

    const calls = fetchFn.mock.calls as [string, RequestInit][]
    expect(calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:9001/v1/converse',
      'http://localhost:9002/v1/converse'
    ])
    expect(calls.map(([, init]) => (init.headers as Record<string, string>).Authorization)).toEqual([
      'Bearer fake-one',
      'Bearer fake-two'
    ])
  })

  it('refuses a Settings endpoint off this machine and the tailnet, sending nothing (review F2)', async () => {
    isolate()
    process.env.ADAM_SERVICE_TOKEN = 'fake-token'
    const fetchFn = vi.fn()
    await expect(
      askAdam({ settingsEndpoint: 'https://adam.example.com', utterance: 'hi', fetchFn })
    ).resolves.toEqual({ kind: 'error', text: ADAM_BLOCKED_ENDPOINT_TEXT })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('still asks without a Bearer header when ADAM is installed but has no token file', async () => {
    const root = isolate()
    process.env.DOBIUS_ADAM_PROJECT_DIR = root
    const fetchFn = vi.fn().mockImplementation(async () => answer())
    await expect(
      askAdam({ settingsEndpoint: undefined, utterance: 'hi', fetchFn })
    ).resolves.toEqual({ kind: 'answer', text: 'ok' })
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:8791/v1/converse')
    expect(init.headers).not.toHaveProperty('Authorization')
  })
})
