import http from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  userData: ''
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => state.userData
  }
}))

vi.mock('./install-clis', () => ({
  installDobiusClis: vi.fn()
}))

vi.mock('../asana/asana-queue-service', () => ({
  getAsanaSnapshot: () => ({ build: [], review: [] }),
  markLocalDone: vi.fn()
}))

async function withServer<T>(
  handler: http.RequestListener,
  run: (port: number) => Promise<T>
): Promise<T> {
  const server = http.createServer(handler)
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('test server did not bind a TCP port')
  }
  try {
    return await run(address.port)
  } finally {
    server.close()
  }
}

function post(
  port: number,
  pathname: string,
  token?: string,
  payload: Record<string, unknown> = {}
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload)
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      method: 'POST',
      headers: {
        Host: '127.0.0.1:8421',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    })
    req.on('response', (res) => {
      let raw = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        raw += chunk
      })
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) as unknown })
      })
    })
    req.on('error', reject)
    req.end(body)
  })
}

describe('dobius CLI dispatch server', () => {
  beforeEach(() => {
    state.userData = mkdtempSync(path.join(tmpdir(), 'dobius-cli-userdata-'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
  })

  it('/tabList requires auth and returns terminal summaries', async () => {
    const mod = await import('./dispatch-server')
    const dispatcher = {
      resolveActiveTerminal: async () => 'term-1',
      sendTerminal: vi.fn(),
      listTerminals: async () => ({
        terminals: [{ handle: 'term-1', title: 'Build', worktreePath: '/repo' }]
      })
    }
    const token = 'a'.repeat(64)

    await withServer(
      (req, res) => {
        void mod.handleDobiusCliRequestForTest(req, res, { token, dispatcher })
      },
      async (port) => {
        await expect(post(port, '/tabList')).resolves.toMatchObject({ status: 401 })
        await expect(post(port, '/tabList', token)).resolves.toEqual({
          status: 200,
          body: { ok: true, tabs: [{ id: 'term-1', title: 'Build', projectPath: '/repo' }] }
        })
      }
    )
  })

  it('/tabRead refuses a limit that is not an integer from 1 to 2000', async () => {
    const mod = await import('./dispatch-server')
    const readTerminal = vi.fn(async () => ({ tail: [] }))
    const dispatcher = {
      resolveActiveTerminal: async () => 'term-1',
      sendTerminal: vi.fn(),
      listTerminals: async () => ({ terminals: [{ handle: 'term-1', title: null }] }),
      readTerminal
    }
    const token = 'a'.repeat(64)

    await withServer(
      (req, res) => {
        void mod.handleDobiusCliRequestForTest(req, res, { token, dispatcher })
      },
      async (port) => {
        for (const limit of [-5, 0, 1.5, 2001, 1e9, '50', null]) {
          const response = await post(port, '/tabRead', token, { id: 'term-1', limit })
          expect(response.body).toMatchObject({ ok: false, error: expect.stringContaining('limit') })
        }
        expect(readTerminal).not.toHaveBeenCalled()

        await post(port, '/tabRead', token, { id: 'term-1', limit: 50 })
        await post(port, '/tabRead', token, { id: 'term-1' })
        expect(readTerminal.mock.calls).toEqual([
          ['term-1', { limit: 50 }],
          ['term-1', { limit: 200 }]
        ])
      }
    )
  })

  it('/tabSend answers with a timeout instead of hanging on a stuck terminal', async () => {
    const mod = await import('./dispatch-server')
    const dispatcher = {
      resolveActiveTerminal: async () => 'term-1',
      sendTerminal: vi.fn(() => new Promise<never>(() => {})),
      listTerminals: async () => ({ terminals: [] })
    }
    const token = 'a'.repeat(64)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const sent = new PassThrough()
      const req = Object.assign(sent, {
        socket: { remoteAddress: '127.0.0.1' },
        method: 'POST',
        url: '/tabSend',
        headers: {
          host: '127.0.0.1:8421',
          'content-type': 'application/json',
          authorization: `Bearer ${token}`
        }
      }) as unknown as http.IncomingMessage
      const res = { writeHead: vi.fn(), end: vi.fn() }
      const handled = mod.handleDobiusCliRequestForTest(
        req,
        res as unknown as http.ServerResponse,
        { token, dispatcher }
      )
      sent.end(JSON.stringify({ message: 'echo hi' }))
      await vi.advanceTimersByTimeAsync(10_000)
      await handled

      expect(dispatcher.sendTerminal).toHaveBeenCalledTimes(1)
      expect(res.writeHead).toHaveBeenCalledWith(500, expect.anything())
      expect(JSON.parse(String(res.end.mock.calls[0]?.[0]))).toEqual({
        ok: false,
        error: 'timed out'
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
