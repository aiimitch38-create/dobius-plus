import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  userDataRoot: '',
  bypassPermissions: false
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mocks.query }))
vi.mock('../storage/user-data-root', () => ({ getUserDataRoot: () => mocks.userDataRoot }))
vi.mock('./agent-tools/dobius-tool-server', () => ({ buildDobiusToolServer: vi.fn(() => ({})) }))
vi.mock('./agents-config-store', () => ({
  getAgentsControlState: () => ({
    paused: false,
    status: 'ok',
    detail: null,
    filePath: '/data/agents-config.json'
  })
}))
vi.mock('./agents-store', () => ({
  getAgent: (id: string) => ({
    id,
    name: 'Atlas',
    engine: 'claude',
    model: 'claude-opus-4-8',
    allowedTools: ['Bash', 'Read'],
    skills: [],
    cwd: '/repo',
    bypassPermissions: mocks.bypassPermissions
  }),
  getAgentSessionForKey: () => null,
  updateAgentSession: vi.fn()
}))
vi.mock('./agent-runs-store', () => ({
  addStoredAgentRun: vi.fn(),
  getStoredAgentRun: vi.fn(),
  listStoredAgentRuns: () => [],
  updateStoredAgentRun: vi.fn(() => true)
}))
vi.mock('./agent-run-events', () => ({
  broadcastRunEvent: vi.fn(),
  broadcastRunsChanged: vi.fn(),
  eventBase: (runId: string, agentId: string) => ({ runId, agentId, at: 0 }),
  reduceMessage: () => []
}))
vi.mock('./agent-decision-queue', () => ({
  createAgentCanUseTool: vi.fn(),
  denyPendingDecisionsForRun: vi.fn(),
  setDecisionBypassRunHandler: vi.fn()
}))
vi.mock('./agent-hard-rails', () => ({ buildAgentHardRailHooks: vi.fn(() => ({})) }))
vi.mock('./agent-notification-store', () => ({ appendAgentRunNotification: vi.fn() }))
vi.mock('./agent-run-progress-log', () => ({ appendRunProgress: vi.fn() }))
vi.mock('./agent-runner-environment', () => ({
  buildRunEnv: vi.fn(() => ({})),
  currentGitBranch: vi.fn(() => 'main'),
  resolveAgentRunCwd: (cwd: string) => cwd
}))
vi.mock('./agent-run-prompt', () => ({ buildSystemPrompt: () => '' }))
vi.mock('./default-codex-launch', () => ({ getDefaultPrepareCodexLaunch: () => () => null }))
vi.mock('./codex-agent-execution', () => ({ startCodexAgentProcess: vi.fn() }))
vi.mock('../codex-cli/command', () => ({ resolveClaudeCommand: () => 'claude' }))

import { startAgentRun } from './agent-runner'

type CapturedOptions = {
  sandbox?: {
    enabled?: boolean
    allowUnsandboxedCommands?: boolean
    failIfUnavailable?: boolean
    filesystem?: { allowRead?: string[]; denyRead?: string[]; denyWrite?: string[] }
  }
  disallowedTools?: string[]
  permissionMode?: string
}

function pendingQuery() {
  return {
    [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
    setPermissionMode: vi.fn(),
    interrupt: vi.fn()
  }
}

let home: string
let agents: string

const prepareClaudeLaunch = vi.fn(async () => ({ configDir: path.join(home, 'work-claude') }) as never)

async function launch(options: Parameters<typeof startAgentRun>[0]['options']) {
  // Each launch holds a slot (the query never ends); this file stays under the cap of 8.
  await startAgentRun({ agentId: 'atlas', prompt: 'go', prepareClaudeLaunch, options })
  const captured = mocks.query.mock.calls.at(-1)?.at(0) as { options: CapturedOptions }
  return captured.options
}

function expectConfined(options: CapturedOptions): void {
  expect(options.sandbox).toMatchObject({
    enabled: true,
    allowUnsandboxedCommands: false,
    failIfUnavailable: true
  })
  expect(options.sandbox?.filesystem?.denyRead).toContain(agents)
  expect(options.sandbox?.filesystem?.allowRead).toEqual([path.join(agents, 'atlas')])
  expect(options.sandbox?.filesystem?.denyWrite).toContain(path.join(agents, 'nova'))
  expect(options.sandbox?.filesystem?.denyRead).toContain(
    path.join(home, 'work-claude', '.credentials*')
  )
  expect(options.disallowedTools).toContain(`Read(/${path.join(agents, 'nova', '**')})`)
}

beforeAll(() => {
  home = mkdtempSync(path.join(os.tmpdir(), 'dobius-sbx-run-'))
  agents = path.join(home, '.dobius', 'agents')
  for (const id of ['atlas', 'nova']) {
    mkdirSync(path.join(agents, id), { recursive: true })
  }
  mocks.userDataRoot = path.join(home, 'user-data')
})

afterAll(() => {
  rmSync(home, { recursive: true, force: true })
})

beforeEach(() => {
  vi.spyOn(os, 'homedir').mockReturnValue(home)
  mocks.bypassPermissions = false
  mocks.query.mockReset()
  mocks.query.mockImplementation(pendingQuery)
})

describe('startAgentRun sandbox (SDK query arguments)', () => {
  it.each([
    ['manual (Agents page)', { origin: 'agents-page' as const }],
    ['heartbeat', { source: 'heartbeat' as const }],
    ['channel', { source: 'channel' as const }],
    ['asana', { source: 'asana' as const, asanaLane: 'build' as const, asanaTaskGid: '1200' }],
    ['voice conductor', { source: 'channel' as const, profile: 'voice-conductor' as const }],
    ['iMessage', { source: 'channel' as const, profile: 'imessage' as const }]
  ])('%s run is confined', async (_label, options) => {
    expectConfined(await launch(options))
  })

  it('a bypass-permissions agent is confined too', async () => {
    mocks.bypassPermissions = true
    const options = await launch(undefined)
    expect(options.permissionMode).toBe('bypassPermissions')
    expectConfined(options)
  })

  it('does not start the run when the sandbox policy cannot be built', async () => {
    const brokenHome = mkdtempSync(path.join(os.tmpdir(), 'dobius-sbx-broken-'))
    try {
      mkdirSync(path.join(brokenHome, '.dobius'), { recursive: true })
      writeFileSync(path.join(brokenHome, '.dobius', 'agents'), 'not a folder')
      vi.spyOn(os, 'homedir').mockReturnValue(brokenHome)
      await expect(
        startAgentRun({ agentId: 'atlas', prompt: 'go', prepareClaudeLaunch })
      ).rejects.toThrow(/cannot list the agents folder/)
      expect(mocks.query).not.toHaveBeenCalled()
    } finally {
      rmSync(brokenHome, { recursive: true, force: true })
    }
  })
})
