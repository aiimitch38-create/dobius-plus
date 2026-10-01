import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The runner with its neighbours faked and the REAL execution gate, talking to
// a local fake ADAM on an ephemeral port. No real ADAM, userData or agent is
// ever touched (docs/stabilization/TEST-PLAN.md ground rules).
const mocks = vi.hoisted(() => ({
  paused: false,
  query: vi.fn(),
  startCodexAgentProcess: vi.fn(),
  addStoredAgentRun: vi.fn(),
  engine: 'claude' as 'claude' | 'codex',
  session: null as null | { sessionId: string; cwd: string }
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mocks.query }))
vi.mock('./agents-config-store', () => ({
  getAgentsControlState: () => ({
    paused: mocks.paused,
    status: 'ok',
    detail: null,
    filePath: '/data/agents-config.json'
  })
}))
vi.mock('./agents-store', () => ({
  getAgent: (id: string) => ({
    id,
    name: 'Atlas',
    engine: mocks.engine,
    model: 'claude-opus-4-8',
    allowedTools: [],
    skills: [],
    cwd: '/repo',
    bypassPermissions: false
  }),
  getAgentSessionForKey: () => mocks.session,
  updateAgentSession: vi.fn()
}))
vi.mock('./agent-runs-store', () => ({
  addStoredAgentRun: mocks.addStoredAgentRun,
  getStoredAgentRun: vi.fn(),
  listStoredAgentRuns: () => [],
  updateStoredAgentRun: vi.fn(() => true)
}))
vi.mock('./agent-run-events', () => ({
  broadcastRunEvent: vi.fn(),
  broadcastRunsChanged: vi.fn(),
  eventBase: (runId: string, agentId: string) => ({ runId, agentId, ts: 0 }),
  reduceMessage: () => []
}))
vi.mock('./agent-decision-queue', () => ({
  createAgentCanUseTool: vi.fn(),
  denyPendingDecisionsForRun: vi.fn(),
  setDecisionBypassRunHandler: vi.fn()
}))
vi.mock('./agent-hard-rails', () => ({ buildAgentHardRailHooks: vi.fn(() => ({})) }))
vi.mock('./agent-sandbox-context', () => ({
  resolveAgentRunSandboxPolicy: () => ({ sandbox: { enabled: true }, disallowedTools: [] })
}))
vi.mock('./agent-notification-store', () => ({ appendAgentRunNotification: vi.fn() }))
vi.mock('./agent-run-progress-log', () => ({ appendRunProgress: vi.fn() }))
vi.mock('./agent-runner-environment', () => ({
  buildRunEnv: vi.fn(() => ({})),
  currentGitBranch: vi.fn(() => 'main'),
  resolveAgentRunCwd: (cwd: string) => cwd,
  resolveAgentRunCwdPath: (cwd: string) => cwd
}))
vi.mock('./agent-runner-dobius-tools', () => ({
  buildDobiusRunMcpServer: vi.fn(() => ({})),
  buildProfileAllowedTools: (_profile: unknown, tools: string[]) => tools,
  builtInToolsFor: () => undefined,
  resolveAgentRunProfile: () => ({ id: 'manual', dobiusTools: [], channelBaseline: false })
}))
vi.mock('./agent-run-prompt', () => ({ buildSystemPrompt: () => '' }))
vi.mock('./default-codex-launch', () => ({ getDefaultPrepareCodexLaunch: () => () => null }))
vi.mock('./codex-agent-execution', () => ({
  startCodexAgentProcess: mocks.startCodexAgentProcess
}))
vi.mock('../codex-cli/command', () => ({ resolveClaudeCommand: () => 'claude' }))

import { setAdamEndpointSettingReader } from '../adam-connection'
import { hasLiveAgentRun, startAgentRun } from './agent-runner'
import { buildRunEnv } from './agent-runner-environment'

const ENV_KEYS = [
  'ADAM_SERVICE_URL',
  'ADAM_SERVICE_TOKEN',
  'ADAM_SERVICE_TOKEN_PATH',
  'DOBIUS_ADAM_TOKEN_PATH',
  'DOBIUS_ADAM_PROJECT_DIR'
]
const FAKE_TOKEN = 'fake-adam-token-for-run-tests'
const REFUSAL_CODES = [
  'unknown_project',
  'project_not_managed',
  'location_unverified',
  'readiness_too_low'
]

type Seen = { method?: string; url?: string; authorization?: string; body: unknown }
type Reply = (req: IncomingMessage, res: ServerResponse) => void

let server: Server
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

function admit(): Reply {
  return json(200, {
    ok: true,
    contextPack: { projectId: 'dobius-plus', digest: 'pack-digest-1', toolPolicyTier: 'restricted' }
  })
}

function refuse(code: string): Reply {
  return json(403, {
    ok: false,
    error: 'context handshake failed',
    code,
    reason: `because ${code}`
  })
}

const handshake = {
  method: 'POST',
  url: '/v1/context-handshake',
  authorization: `Bearer ${FAKE_TOKEN}`,
  body: { worktreePath: '/repo', intent: 'launch' }
}

// Admitted runs stay open (holding their slot and session claim) until the
// test ends; afterEach finishes them so no case leaks state into the next.
const openQueries: (() => void)[] = []
const codexFinishers: ((status: 'cancelled', summary: string) => void)[] = []

function pendingQuery() {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () =>
        new Promise<IteratorResult<never>>((resolve) => {
          openQueries.push(() => resolve({ done: true, value: undefined as never }))
        })
    }),
    setPermissionMode: vi.fn(),
    interrupt: vi.fn()
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

const prepareClaudeLaunch = vi.fn(async () => ({}) as never)

function storedContext(): unknown {
  return mocks.addStoredAgentRun.mock.calls.at(-1)?.[0]?.context
}

beforeEach(async () => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
  for (const key of ENV_KEYS) {
    delete process.env[key]
  }
  tempRoot = mkdtempSync(join(tmpdir(), 'adam-run-gate-'))
  // Why: the default endpoint and token path are the real local ADAM.
  process.env.DOBIUS_ADAM_PROJECT_DIR = join(tempRoot, 'no-adam-here')
  setAdamEndpointSettingReader(() => undefined)
  mocks.paused = false
  mocks.engine = 'claude'
  mocks.session = null
  mocks.query.mockReset()
  mocks.query.mockImplementation(pendingQuery)
  mocks.startCodexAgentProcess.mockReset()
  mocks.startCodexAgentProcess.mockImplementation(
    (args: { onFinish: (status: 'cancelled', summary: string) => void }) => {
      codexFinishers.push(args.onFinish)
      return undefined
    }
  )
  mocks.addStoredAgentRun.mockReset()
  prepareClaudeLaunch.mockReset()
  prepareClaudeLaunch.mockImplementation(async () => ({}) as never)
  seen = []
  reply = admit()
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
  process.env.ADAM_SERVICE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  process.env.ADAM_SERVICE_TOKEN = FAKE_TOKEN
})

afterEach(async () => {
  for (const end of openQueries.splice(0)) {
    end()
  }
  for (const finish of codexFinishers.splice(0)) {
    finish('cancelled', 'test finished')
  }
  await settle()
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

describe('startAgentRun ADAM admission (B2 run-adoption gate)', () => {
  it('admits an autonomous Claude run only after ADAM answers, before and again after auth preparation', async () => {
    let handshakesBeforePrepare = -1
    prepareClaudeLaunch.mockImplementation(async () => {
      handshakesBeforePrepare = seen.length
      return {} as never
    })
    const runId = await startAgentRun({ agentId: 'claude-ok', prompt: 'go', prepareClaudeLaunch })
    expect(seen).toEqual([handshake, handshake])
    expect(handshakesBeforePrepare).toBe(1)
    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(storedContext()).toEqual({
      correlationId: runId,
      projectId: 'dobius-plus',
      contextDigest: 'pack-digest-1'
    })
  })

  it("ADAM's project and digest replace what the caller supplied; the rest of the context is kept", async () => {
    await startAgentRun({
      agentId: 'claude-ctx',
      prompt: 'go',
      prepareClaudeLaunch,
      options: {
        context: {
          correlationId: 'corr-9',
          adamJobId: 'job-1',
          projectId: 'spoofed-project',
          contextDigest: 'forged-digest'
        }
      }
    })
    expect(storedContext()).toEqual({
      correlationId: 'corr-9',
      adamJobId: 'job-1',
      projectId: 'dobius-plus',
      contextDigest: 'pack-digest-1'
    })
  })

  it.each(REFUSAL_CODES)(
    'refuses an autonomous run on %s before anything is prepared, stored or spawned',
    async (code) => {
      reply = refuse(code)
      const agentId = `refused-${code}`
      await expect(
        startAgentRun({ agentId, prompt: 'go', prepareClaudeLaunch })
      ).rejects.toMatchObject({
        name: 'ExecutionBlockedError',
        origin: 'agent-run',
        reason: 'adam-refused',
        message: expect.stringContaining(code)
      })
      expect(seen).toEqual([handshake])
      expect(prepareClaudeLaunch).not.toHaveBeenCalled()
      expect(mocks.query).not.toHaveBeenCalled()
      expect(mocks.addStoredAgentRun).not.toHaveBeenCalled()
      expect(hasLiveAgentRun(agentId)).toBe(false)
    }
  )

  it('never echoes the ADAM token in a refusal', async () => {
    reply = json(401, { ok: false, error: 'unauthorized' })
    let message = ''
    await startAgentRun({ agentId: 'token-safe', prompt: 'go', prepareClaudeLaunch }).catch(
      (error: Error) => {
        message = error.message
      }
    )
    expect(message).toContain('401')
    expect(message).not.toContain(FAKE_TOKEN)
  })

  it('blocks autonomous runs while ADAM is offline', async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    server = createServer()
    await expect(
      startAgentRun({ agentId: 'offline', prompt: 'go', prepareClaudeLaunch })
    ).rejects.toMatchObject({
      name: 'ExecutionBlockedError',
      reason: 'adam-unavailable',
      message: expect.stringContaining('ADAM offline')
    })
    expect(mocks.query).not.toHaveBeenCalled()
    expect(mocks.addStoredAgentRun).not.toHaveBeenCalled()
  })

  it('blocks autonomous runs when ADAM is not installed, without sending anything', async () => {
    delete process.env.ADAM_SERVICE_TOKEN
    await expect(
      startAgentRun({ agentId: 'no-adam', prompt: 'go', prepareClaudeLaunch })
    ).rejects.toMatchObject({
      name: 'ExecutionBlockedError',
      reason: 'adam-unavailable',
      message: expect.stringContaining('not installed')
    })
    expect(seen).toEqual([])
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it('a refusal that arrives during auth preparation still stops the run and releases its slot', async () => {
    prepareClaudeLaunch.mockImplementation(async () => {
      reply = refuse('project_not_managed')
      return {} as never
    })
    // More attempts than the concurrency cap (8): a leaked reservation would
    // surface as AgentRunCapacityError instead of the gate's refusal.
    for (let i = 0; i < 9; i += 1) {
      reply = admit()
      await expect(
        startAgentRun({ agentId: `late-refusal-${i}`, prompt: 'go', prepareClaudeLaunch })
      ).rejects.toMatchObject({ name: 'ExecutionBlockedError', reason: 'adam-refused' })
      expect(hasLiveAgentRun(`late-refusal-${i}`)).toBe(false)
    }
    expect(prepareClaudeLaunch).toHaveBeenCalledTimes(9)
    expect(mocks.query).not.toHaveBeenCalled()
    expect(mocks.addStoredAgentRun).not.toHaveBeenCalled()

    // The refused runs' session claims must be gone too: a leaked claim on this
    // agent's 'default' key would force the follow-up run to start fresh
    // instead of resuming its keyed session.
    prepareClaudeLaunch.mockImplementation(async () => ({}) as never)
    reply = admit()
    mocks.session = { sessionId: 's-after-refusal', cwd: '/repo' }
    await startAgentRun({ agentId: 'late-refusal-0', prompt: 'go', prepareClaudeLaunch })
    expect(mocks.query).toHaveBeenCalledWith(
      expect.objectContaining({ options: expect.objectContaining({ resume: 's-after-refusal' }) })
    )
  })

  it("gates a Codex agent before its spawn and records ADAM's context on the run", async () => {
    mocks.engine = 'codex'
    reply = refuse('unknown_project')
    await expect(
      startAgentRun({ agentId: 'codex-refused', prompt: 'go', prepareClaudeLaunch })
    ).rejects.toMatchObject({ name: 'ExecutionBlockedError', reason: 'adam-refused' })
    expect(mocks.startCodexAgentProcess).not.toHaveBeenCalled()
    expect(mocks.addStoredAgentRun).not.toHaveBeenCalled()

    reply = admit()
    const runId = await startAgentRun({ agentId: 'codex-ok', prompt: 'go', prepareClaudeLaunch })
    // Codex has no await between admission and spawn, so one handshake suffices.
    expect(seen).toEqual([handshake, handshake])
    expect(mocks.startCodexAgentProcess).toHaveBeenCalledTimes(1)
    expect(storedContext()).toEqual({
      correlationId: runId,
      projectId: 'dobius-plus',
      contextDigest: 'pack-digest-1'
    })
  })

  it('leaves a manual Agents-page run pause-only while the same ADAM refuses autonomous runs', async () => {
    reply = refuse('unknown_project')
    const runId = await startAgentRun({
      agentId: 'page',
      prompt: 'go',
      prepareClaudeLaunch,
      options: { origin: 'agents-page' }
    })
    expect(seen).toEqual([])
    expect(mocks.query).toHaveBeenCalledTimes(1)
    expect(storedContext()).toEqual({ correlationId: runId })

    await expect(
      startAgentRun({ agentId: 'auto', prompt: 'go', prepareClaudeLaunch })
    ).rejects.toMatchObject({ name: 'ExecutionBlockedError', reason: 'adam-refused' })
    expect(seen).toEqual([handshake])
    expect(mocks.query).toHaveBeenCalledTimes(1)
  })
})

describe('startAgentRun context delivery (B5)', () => {
  const contextFile = (cwd: string): string => join(cwd, '.dobius', 'context', 'current.json')

  function checkoutDir(name: string): string {
    const cwd = join(tempRoot, name)
    mkdirSync(join(cwd, '.git'), { recursive: true })
    return cwd
  }

  function lastQueryOptions(): { env?: Record<string, string>; systemPrompt?: unknown } {
    return mocks.query.mock.calls.at(-1)?.[0]?.options ?? {}
  }

  beforeEach(() => {
    // The run env the preparer built must survive the merge (never clobbered).
    vi.mocked(buildRunEnv).mockReturnValue({ CLAUDE_CONFIG_DIR: '/cfg' })
  })

  it("hands ADAM's context to an admitted Claude run: env vars, current.json and a prompt banner", async () => {
    const cwd = checkoutDir('claude-repo')
    await startAgentRun({
      agentId: 'claude-delivery',
      prompt: 'go',
      cwd,
      prepareClaudeLaunch,
      options: { context: { correlationId: 'corr-1', worktreeId: 'wt-3' } }
    })
    expect(seen.at(-1)?.body).toEqual({ worktreePath: cwd, intent: 'launch' })
    expect(lastQueryOptions().env).toEqual({
      CLAUDE_CONFIG_DIR: '/cfg',
      DOBIUS_PROJECT_ID: 'dobius-plus',
      DOBIUS_CONTEXT_DIGEST: 'pack-digest-1',
      DOBIUS_WORKTREE_ID: 'wt-3'
    })
    // buildSystemPrompt is faked to '' here, so the banner rides the preset.
    expect(lastQueryOptions().systemPrompt).toEqual({
      type: 'preset',
      preset: 'claude_code',
      append: 'Dobius context: project=dobius-plus digest=pack-digest-1'
    })
    expect(JSON.parse(readFileSync(contextFile(cwd), 'utf-8'))).toMatchObject({
      projectId: 'dobius-plus',
      contextDigest: 'pack-digest-1',
      worktree: 'wt-3',
      origin: 'agent-run'
    })
    expect(readFileSync(join(cwd, '.gitignore'), 'utf-8')).toBe('.dobius/\n')
  })

  it("hands ADAM's context to an admitted Codex run through its spawn env and prompt", async () => {
    mocks.engine = 'codex'
    const cwd = checkoutDir('codex-repo')
    await startAgentRun({ agentId: 'codex-delivery', prompt: 'go', cwd, prepareClaudeLaunch })
    expect(mocks.startCodexAgentProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd,
        env: { DOBIUS_PROJECT_ID: 'dobius-plus', DOBIUS_CONTEXT_DIGEST: 'pack-digest-1' },
        contextBanner: 'Dobius context: project=dobius-plus digest=pack-digest-1'
      })
    )
    expect(JSON.parse(readFileSync(contextFile(cwd), 'utf-8'))).toMatchObject({
      projectId: 'dobius-plus',
      origin: 'agent-run'
    })
  })

  it('delivers nothing to a manual Agents-page run (no admitted pack)', async () => {
    const cwd = checkoutDir('manual-repo')
    await startAgentRun({
      agentId: 'manual',
      prompt: 'go',
      cwd,
      prepareClaudeLaunch,
      options: { origin: 'agents-page', context: { correlationId: 'c', projectId: 'caller-said' } }
    })
    expect(lastQueryOptions().env).toEqual({ CLAUDE_CONFIG_DIR: '/cfg' })
    expect(lastQueryOptions().systemPrompt).toBeUndefined()
    expect(existsSync(contextFile(cwd))).toBe(false)
    expect(existsSync(join(cwd, '.gitignore'))).toBe(false)
  })
})
