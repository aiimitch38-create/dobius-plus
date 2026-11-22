import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>())
const conductor = vi.hoisted(() => ({ post: vi.fn(), reply: vi.fn() }))
const actions = vi.hoisted(() => ({ decide: vi.fn(), approve: vi.fn(), setPaused: vi.fn() }))
const registry = vi.hoisted(() => ({ trusted: new Set<unknown>() }))

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

vi.mock('../window/renderer-window-registry', () => ({
  isRegisteredRendererWebContents: (contents: unknown) => registry.trusted.has(contents)
}))

// Why: registerAgentsHandlers starts heartbeats and touches many stores; only the
// Board conductor handlers are under test, so every collaborator is stubbed.
vi.mock('../agents/agent-briefing-store', () => ({}))
vi.mock('../agents/agent-decision-queue', () => ({ resolveAgentDecision: actions.decide }))
vi.mock('../agents/agent-draft-approval', () => ({ approveDraftAndPost: actions.approve }))
vi.mock('../agents/agent-draft-store', () => ({}))
vi.mock('../agents/agent-heartbeat-service', () => ({ startAgentHeartbeats: vi.fn() }))
vi.mock('../agents/agent-identity-files', () => ({}))
vi.mock('../agents/agent-notification-store', () => ({}))
vi.mock('../agents/agent-runner', () => ({}))
vi.mock('../agents/agent-tools/dobius-tool-server', () => ({
  setDobiusToolKnowledgeStore: vi.fn()
}))
vi.mock('../agents/agents-config-store', () => ({ setAgentsPaused: actions.setPaused }))
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

const appWindow = { isDestroyed: () => false }
const topFrame = { parent: null }

function event(sender: unknown, senderFrame: unknown = topFrame) {
  return { sender, senderFrame }
}

const CASES = [
  ['agents:resolveDecision', { id: 'd1', action: 'approve' }, actions.decide],
  ['agents:approveDraft', 'dr1', actions.approve],
  ['agents:setPaused', false, actions.setPaused]
] as const

describe('agents IPC: only the app window may approve, post or resume', () => {
  beforeEach(async () => {
    handlers.clear()
    registry.trusted = new Set([appWindow])
    for (const action of Object.values(actions)) {
      action.mockReset()
    }
    await register()
  })

  it.each(CASES)('%s works from the app window top frame', async (channel, arg, action) => {
    await handlers.get(channel)?.(event(appWindow), arg)
    expect(action).toHaveBeenCalledWith(arg)
  })

  it.each(CASES)('%s refuses a sender that is not an app window', async (channel, arg, action) => {
    const guest = { isDestroyed: () => false }
    expect(() => handlers.get(channel)?.(event(guest), arg)).toThrow('only available')
    expect(action).not.toHaveBeenCalled()
  })

  it.each(CASES)('%s refuses a subframe of the app window', async (channel, arg, action) => {
    expect(() => handlers.get(channel)?.(event(appWindow, { parent: topFrame }), arg)).toThrow(
      'only available'
    )
    expect(action).not.toHaveBeenCalled()
  })

  it.each(CASES)('%s refuses a destroyed sender', async (channel, arg, action) => {
    const gone = { isDestroyed: () => true }
    registry.trusted.add(gone)
    expect(() => handlers.get(channel)?.(event(gone), arg)).toThrow('only available')
    expect(action).not.toHaveBeenCalled()
  })
})
