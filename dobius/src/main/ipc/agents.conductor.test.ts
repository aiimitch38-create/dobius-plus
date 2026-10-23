import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>())
const conductor = vi.hoisted(() => ({ post: vi.fn(), reply: vi.fn() }))

vi.mock('electron', () => ({
  dialog: {},
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel)
    }
  }
}))

// Why: registerAgentsHandlers starts heartbeats and touches many stores; only the
// Board conductor handlers are under test, so every collaborator is stubbed.
vi.mock('../agents/agent-briefing-store', () => ({}))
vi.mock('../agents/agent-decision-queue', () => ({}))
vi.mock('../agents/agent-draft-approval', () => ({}))
vi.mock('../agents/agent-draft-store', () => ({}))
vi.mock('../agents/agent-heartbeat-service', () => ({ startAgentHeartbeats: vi.fn() }))
vi.mock('../agents/agent-identity-files', () => ({}))
vi.mock('../agents/agent-notification-store', () => ({}))
vi.mock('../agents/agent-runner', () => ({}))
vi.mock('../agents/agent-tools/dobius-tool-server', () => ({
  setDobiusToolKnowledgeStore: vi.fn()
}))
vi.mock('../agents/agents-config-store', () => ({}))
vi.mock('../agents/agents-store', () => ({}))
vi.mock('../agents/asana-auto-mode-service', () => ({ startAsanaAutoMode: vi.fn() }))
vi.mock('../agents/default-claude-launch', () => ({ setDefaultPrepareClaudeLaunch: vi.fn() }))
vi.mock('../agents/default-codex-launch', () => ({ setDefaultPrepareCodexLaunch: vi.fn() }))
vi.mock('../communications/agents/custom-harness-store', () => ({}))
vi.mock('../communications/providers/custom-harness-instances', () => ({}))
vi.mock('../communications/providers/custom-harness-provider', () => ({}))
vi.mock('../communications/providers/provider-api-key-store', () => ({}))
vi.mock('../voice-conductor/service', () => ({
  postVoiceConductorTranscript: conductor.post,
  getVoiceConductorReply: conductor.reply
}))

async function register(): Promise<void> {
  const { registerAgentsHandlers } = await import('./agents')
  registerAgentsHandlers(vi.fn() as never, vi.fn() as never, {} as never)
}

describe('agents IPC: Board conductor', () => {
  beforeEach(() => {
    handlers.clear()
    conductor.post.mockReset()
    conductor.reply.mockReset()
  })

  it('forwards the transcript and reports ok', async () => {
    await register()
    conductor.post.mockResolvedValue(undefined)
    const input = { requestId: 'r1', transcript: 'spawn two reviewers' }
    await expect(handlers.get('agents:conductorCommand')?.({}, input)).resolves.toEqual({
      ok: true
    })
    expect(conductor.post).toHaveBeenCalledWith(input)
  })

  it('turns a conductor failure into { ok: false, error } instead of rejecting', async () => {
    await register()
    conductor.post.mockRejectedValue(new Error('Voice Conductor is disabled'))
    await expect(
      handlers.get('agents:conductorCommand')?.({}, { requestId: 'r2', transcript: 'hi' })
    ).resolves.toEqual({ ok: false, error: 'Voice Conductor is disabled' })
  })

  it('passes requestId and sinceTs through to the reply store', async () => {
    await register()
    conductor.reply.mockReturnValue({ message: 'done', ts: 42 })
    expect(
      await handlers.get('agents:conductorReply')?.({}, { requestId: 'r1', sinceTs: 10 })
    ).toEqual({
      message: 'done',
      ts: 42
    })
    expect(conductor.reply).toHaveBeenCalledWith('r1', 10)
  })
})
