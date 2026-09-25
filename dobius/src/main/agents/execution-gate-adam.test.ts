import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getAgentsControlState: vi.fn() }))

vi.mock('./agents-config-store', () => ({
  getAgentsControlState: mocks.getAgentsControlState
}))

import { setAdamEndpointSettingReader } from '../adam-connection'
import { checkBuildDispatchAdmission, checkExecutionAdmission } from './execution-gate'

// A local fake ADAM on an ephemeral port; the real service is never contacted.
const ENV_KEYS = [
  'ADAM_SERVICE_URL',
  'ADAM_SERVICE_TOKEN',
  'ADAM_SERVICE_TOKEN_PATH',
  'DOBIUS_ADAM_TOKEN_PATH',
  'DOBIUS_ADAM_PROJECT_DIR'
]
const FAKE_TOKEN = 'fake-adam-token-for-tests'
const REPO_PATH = '/Users/test/Projects/dobius-plus'

type Seen = { method?: string; url?: string; authorization?: string; body: unknown }
type Reply = (req: IncomingMessage, res: ServerResponse) => void

let server: Server
let baseUrl = ''
let reply: Reply
let seen: Seen[] = []
let savedEnv: Record<string, string | undefined> = {}
let tempRoot = ''

function json(status: number, body: unknown): Reply {
  return (_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
}

function controlState(paused: boolean) {
  return { paused, status: 'ok', detail: null, filePath: '/data/agents-config.json' }
}

beforeEach(async () => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
  for (const key of ENV_KEYS) {
    delete process.env[key]
  }
  tempRoot = mkdtempSync(join(tmpdir(), 'adam-gate-'))
  // Why: the default endpoint is the real local ADAM; every test points elsewhere.
  process.env.DOBIUS_ADAM_PROJECT_DIR = join(tempRoot, 'no-adam-here')
  setAdamEndpointSettingReader(() => undefined)
  mocks.getAgentsControlState.mockReset()
  mocks.getAgentsControlState.mockReturnValue(controlState(false))
  seen = []
  reply = json(200, {
    ok: true,
    contextPack: { projectId: 'dobius-plus', digest: 'abc', toolPolicyTier: 'restricted' }
  })
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      seen.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
        body: text ? JSON.parse(text) : undefined
      })
      reply(req, res)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  process.env.ADAM_SERVICE_URL = baseUrl
  process.env.ADAM_SERVICE_TOKEN = FAKE_TOKEN
})

afterEach(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = savedEnv[key]
    }
  }
  setAdamEndpointSettingReader(() => undefined)
  rmSync(tempRoot, { recursive: true, force: true })
})

describe('dispatch_build ADAM handshake (BUILD-031, X12)', () => {
  it('admits when ADAM returns a context pack, sending the repo path with bearer auth', async () => {
    expect(await checkBuildDispatchAdmission(REPO_PATH)).toEqual({ allowed: true })
    expect(seen).toEqual([
      {
        method: 'POST',
        url: '/v1/context-handshake',
        authorization: `Bearer ${FAKE_TOKEN}`,
        body: { worktreePath: REPO_PATH, intent: 'launch' }
      }
    ])
  })

  it.each(['unknown_project', 'project_not_managed', 'location_unverified', 'readiness_too_low'])(
    'blocks on refusal code %s with ADAM’s reason',
    async (code) => {
      reply = json(403, {
        ok: false,
        error: 'context handshake failed',
        code,
        reason: `reason for ${code}`
      })
      const admission = await checkBuildDispatchAdmission(REPO_PATH)
      expect(admission).toMatchObject({ allowed: false, reason: 'adam-refused' })
      const message = admission.allowed ? '' : admission.message
      expect(message).toContain(code)
      expect(message).toContain(`reason for ${code}`)
    }
  )

  it('blocks a 403 without a known code (any resolver throw is a refusal)', async () => {
    reply = json(403, { ok: false, error: 'context handshake failed', reason: 'registry broke' })
    expect(await checkBuildDispatchAdmission(REPO_PATH)).toMatchObject({
      allowed: false,
      reason: 'adam-refused',
      message: expect.stringContaining('registry broke')
    })
  })

  it('treats a 404 (route not deployed) as offline: blocks with "ADAM needs updating"', async () => {
    reply = json(404, { ok: false, error: 'not found' })
    expect(await checkBuildDispatchAdmission(REPO_PATH)).toMatchObject({
      allowed: false,
      reason: 'adam-unavailable',
      message: expect.stringContaining('ADAM needs updating')
    })
  })

  it('blocks on 401 without echoing the token', async () => {
    reply = json(401, { ok: false, error: 'unauthorized' })
    const admission = await checkBuildDispatchAdmission(REPO_PATH)
    expect(admission).toMatchObject({ allowed: false, reason: 'adam-unavailable' })
    const message = admission.allowed ? '' : admission.message
    expect(message).toContain('401')
    expect(message).not.toContain(FAKE_TOKEN)
  })

  it.each([500, 503, 400])('blocks on HTTP %i', async (status) => {
    reply = json(status, { ok: false, error: 'boom' })
    expect(await checkBuildDispatchAdmission(REPO_PATH)).toMatchObject({
      allowed: false,
      reason: 'adam-unavailable',
      message: expect.stringContaining(`HTTP ${status}`)
    })
  })

  it('blocks a 200 that carries no context pack', async () => {
    reply = json(200, { ok: true })
    expect(await checkBuildDispatchAdmission(REPO_PATH)).toMatchObject({
      allowed: false,
      reason: 'adam-unavailable'
    })
  })

  it('blocks when ADAM is offline (connection refused)', async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    server = createServer()
    const admission = await checkBuildDispatchAdmission(REPO_PATH)
    expect(admission).toMatchObject({
      allowed: false,
      reason: 'adam-unavailable',
      message: expect.stringContaining('ADAM offline: ECONNREFUSED')
    })
  })

  it('blocks when ADAM does not answer within the timeout', async () => {
    reply = () => undefined
    const started = Date.now()
    const admission = await checkBuildDispatchAdmission(REPO_PATH, { timeoutMs: 200 })
    expect(Date.now() - started).toBeLessThan(3_000)
    expect(admission).toMatchObject({
      allowed: false,
      reason: 'adam-unavailable',
      message: expect.stringContaining('no answer within 200 ms')
    })
  })

  it('reports a timeout during the body read as a timeout (review F3)', async () => {
    reply = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.write('{"ok":true,')
    }
    expect(await checkBuildDispatchAdmission(REPO_PATH, { timeoutMs: 300 })).toMatchObject({
      allowed: false,
      reason: 'adam-unavailable',
      message: expect.stringContaining('no answer within 300 ms')
    })
  })

  it('blocks a Settings endpoint off this machine without sending anything', async () => {
    delete process.env.ADAM_SERVICE_URL
    setAdamEndpointSettingReader(() => 'https://adam.example.com')
    expect(await checkBuildDispatchAdmission(REPO_PATH)).toMatchObject({
      allowed: false,
      reason: 'adam-unavailable',
      message: expect.stringContaining('endpoint blocked')
    })
    expect(seen).toEqual([])
  })

  it('blocks when ADAM is not installed', async () => {
    delete process.env.ADAM_SERVICE_TOKEN
    expect(await checkBuildDispatchAdmission(REPO_PATH)).toMatchObject({
      allowed: false,
      reason: 'adam-unavailable',
      message: expect.stringContaining('not installed')
    })
    expect(seen).toEqual([])
  })

  it('keeps the pause gate first and re-checks it after the handshake', async () => {
    mocks.getAgentsControlState.mockReturnValue(controlState(true))
    expect(await checkBuildDispatchAdmission(REPO_PATH)).toMatchObject({ reason: 'paused' })
    expect(seen).toEqual([])

    // Paused while ADAM was answering: the pause still wins.
    mocks.getAgentsControlState
      .mockReturnValueOnce(controlState(false))
      .mockReturnValueOnce(controlState(true))
    expect(await checkBuildDispatchAdmission(REPO_PATH)).toMatchObject({ reason: 'paused' })
    expect(seen).toHaveLength(1)
  })

  it('leaves manual runs and every other origin pause-only: no ADAM call', async () => {
    reply = json(403, { ok: false, code: 'unknown_project', reason: 'nope' })
    for (const origin of ['agents-page', 'agent-run', 'dispatch-build', 'imessage-command'] as const) {
      expect(checkExecutionAdmission(origin)).toEqual({ allowed: true })
    }
    // Give any stray request time to arrive.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(seen).toEqual([])
  })
})
