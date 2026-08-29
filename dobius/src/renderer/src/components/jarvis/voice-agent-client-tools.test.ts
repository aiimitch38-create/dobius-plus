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
    pluginToolNames: vi.fn(async () => []),
    runPluginTool: vi.fn(async () => 'plugin ran'),
    remember: vi.fn(async () => 'Saved.'),
    forget: vi.fn(async () => 'Forgotten.'),
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

  it('passes category, key and value through to remember', async () => {
    const jarvis = stubJarvisApi()
    const tools = createVoiceAgentClientTools()
    await tools.remember({ category: 'relationships', key: 'wife', value: 'Ashley' })
    expect(jarvis.remember).toHaveBeenCalledWith('relationships', 'wife', 'Ashley')
  })

  it('forgets by key', async () => {
    const jarvis = stubJarvisApi()
    await createVoiceAgentClientTools().forget({ key: 'disk' })
    expect(jarvis.forget).toHaveBeenCalledWith('disk')
  })

  it('coerces a missing command rather than throwing', async () => {
    const jarvis = stubJarvisApi()
    const tools = createVoiceAgentClientTools()
    await tools.propose_shell({})
    expect(jarvis.proposeShell).toHaveBeenCalledWith('')
  })
})

describe('plugin dispatch', () => {
  it('routes an explicitly listed plugin tool to main', async () => {
    const jarvis = stubJarvisApi()
    const tools = createVoiceAgentClientTools(['plugin_weather'])
    await expect(tools.plugin_weather({ city: 'Perth' })).resolves.toBe('plugin ran')
    expect(jarvis.runPluginTool).toHaveBeenCalledWith('plugin_weather', { city: 'Perth' })
  })

  it('routes an UNRECOGNISED tool name through the fallback', async () => {
    // The case the explicit list cannot cover: a tool synced to the agent after
    // this map was built.
    const jarvis = stubJarvisApi()
    const tools = createVoiceAgentClientTools()
    await expect(tools.plugin_something_new({ a: 1 })).resolves.toBe('plugin ran')
    expect(jarvis.runPluginTool).toHaveBeenCalledWith('plugin_something_new', { a: 1 })
  })

  it('does not let a plugin name shadow a hand-written tool', async () => {
    const jarvis = stubJarvisApi()
    // A plugin claiming `ask_adam` must not take over the real one.
    const tools = createVoiceAgentClientTools(['ask_adam'])
    await tools.ask_adam({ request: 'hello' })
    expect(jarvis.askAdamText).toHaveBeenCalledWith('hello')
    expect(jarvis.runPluginTool).not.toHaveBeenCalled()
  })

  it('is NOT a thenable — the fallback must never answer to `then`', async () => {
    // Regression, measured: with `then` dispatchable the map is a thenable, and
    // `Promise.resolve(tools)` hung forever. The map is handed to the SDK inside
    // an options object, so one await upstream would freeze the conversation at
    // startup with nothing to show for it.
    stubJarvisApi()
    const tools = createVoiceAgentClientTools()
    expect((tools as unknown as { then?: unknown }).then).toBeUndefined()

    const settled = await Promise.race([
      Promise.resolve(tools).then(() => 'resolved'),
      new Promise((resolve) => setTimeout(() => resolve('hung'), 200))
    ])
    expect(settled).toBe('resolved')
  })

  it('still answers to inherited object keys rather than dispatching them', () => {
    stubJarvisApi()
    const tools = createVoiceAgentClientTools()
    // `in` walks the prototype chain, so these resolve on the target and are
    // never mistaken for tool names.
    expect(typeof (tools as unknown as { toString: unknown }).toString).toBe('function')
    expect((tools as unknown as { constructor: unknown }).constructor).toBe(Object)
  })

  it('keeps enumeration honest — the fallback is not a listed key', () => {
    stubJarvisApi()
    const names = Object.keys(createVoiceAgentClientTools(['plugin_weather']))
    // The wiring check greps for these; a catch-all must not swallow them.
    expect(names).toEqual(
      expect.arrayContaining([
        'ask_adam',
        'get_context',
        'run_dobius',
        'propose_code_change',
        'apply_code_change',
        'remember',
        'forget',
        'propose_shell',
        'plugin_weather'
      ])
    )
    expect(names).not.toContain('plugin_something_new')
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
        id: 'shell_1',
        category: 'notes',
        key: 'k',
        value: 'v'
      }).catch(() => undefined)
      expect(jarvis.runApprovedShell, `${name} reached runApprovedShell`).not.toHaveBeenCalled()
    }

    expect(jarvis.runApprovedShell).not.toHaveBeenCalled()
    expect(jarvis.discardShellCommand).not.toHaveBeenCalled()
  })

  it('holds through the plugin fallback, which enumeration cannot reach', async () => {
    // The catch-all is a NEW way into the map, and Object.entries does not see
    // it, so the loop above cannot cover it. Names chosen to be exactly what an
    // attacker-shaped plugin would pick.
    const jarvis = stubJarvisApi()
    const tools = createVoiceAgentClientTools()
    for (const name of ['approve_shell', 'run_approved_shell', 'apply_shell', 'plugin_evil']) {
      await tools[name]({ proposal_id: 'shell_1', id: 'shell_1', command: 'rm -rf /' }).catch(
        () => undefined
      )
      expect(jarvis.runApprovedShell, `${name} reached runApprovedShell`).not.toHaveBeenCalled()
    }
    expect(jarvis.discardShellCommand).not.toHaveBeenCalled()
    // Everything unrecognised goes to plugin dispatch and nowhere else.
    expect(jarvis.runPluginTool).toHaveBeenCalledTimes(4)
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
