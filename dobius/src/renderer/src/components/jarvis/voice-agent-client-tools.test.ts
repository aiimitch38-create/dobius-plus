import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVoiceAgentClientTools } from './voice-agent-client-tools'

/** Every jarvis preload method, as a spy, so no tool can reach a real one. */
function stubJarvisApi(): Record<string, ReturnType<typeof vi.fn>> {
  const jarvis = {
    askAdamText: vi.fn(async () => ({ kind: 'answer', text: 'ok' })),
    agentContext: vi.fn(async () => 'context'),
    runDobius: vi.fn(async () => 'ran'),
    proposeSelfEdit: vi.fn(async () => ({ ok: true, id: 'edit_1', displayPath: 'a.ts' })),
    applySelfEdit: vi.fn(async () => ({ ok: true, displayPath: 'a.ts' })),
    discardSelfEdit: vi.fn(async () => ({ ok: true })),
    proposeShell: vi.fn(async () => 'waiting for approval'),
    runApprovedShell: vi.fn(async () => ({ ok: true, output: 'PWNED' })),
    discardShellCommand: vi.fn(async () => ({ ok: true }))
  }
  vi.stubGlobal('window', { api: { jarvis } })
  return jarvis as unknown as Record<string, ReturnType<typeof vi.fn>>
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('voice agent client tools', () => {
  it('exposes propose_shell', () => {
    stubJarvisApi()
    expect(Object.keys(createVoiceAgentClientTools())).toContain('propose_shell')
  })

  it('proposes a shell command without approving it', async () => {
    const jarvis = stubJarvisApi()
    const tools = createVoiceAgentClientTools()
    const spoken = await tools.propose_shell({ command: 'rm -rf /tmp/x' })

    expect(jarvis.proposeShell).toHaveBeenCalledWith('rm -rf /tmp/x')
    expect(jarvis.runApprovedShell).not.toHaveBeenCalled()
    expect(spoken).toBe('waiting for approval')
  })

  it('coerces a missing command rather than throwing', async () => {
    const jarvis = stubJarvisApi()
    const tools = createVoiceAgentClientTools()
    await tools.propose_shell({})
    expect(jarvis.proposeShell).toHaveBeenCalledWith('')
  })
})

describe('INVARIANT A — the model can never authorise shell execution', () => {
  it('has no tool, anywhere in the map, that runs an approved command', async () => {
    const jarvis = stubJarvisApi()
    const tools = createVoiceAgentClientTools()

    // Every tool, not a hand-listed few: a tool added carelessly later must
    // fail this test rather than slip past a list nobody remembered to update.
    for (const [name, tool] of Object.entries(tools)) {
      await tool({
        command: 'x',
        request: 'x',
        path: 'a.ts',
        content: 'x',
        description: 'x',
        // The handle an approve-tool would need. Nothing may act on it.
        proposal_id: 'shell_1',
        id: 'shell_1'
      }).catch(() => undefined)
      expect(jarvis.runApprovedShell, `${name} reached runApprovedShell`).not.toHaveBeenCalled()
    }

    expect(jarvis.runApprovedShell).not.toHaveBeenCalled()
    expect(jarvis.discardShellCommand).not.toHaveBeenCalled()
  })

  it('exposes no tool whose name suggests shell approval', () => {
    stubJarvisApi()
    const names = Object.keys(createVoiceAgentClientTools())
    expect(names).not.toContain('approve_shell')
    expect(names).not.toContain('run_shell')
    expect(names).not.toContain('apply_shell')
    expect(names).not.toContain('run_approved_shell')
  })
})
