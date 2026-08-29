import { describe, expect, it } from 'vitest'
import type { AdamPlugin } from './plugin-loader'
import type { ToolSummary } from './elevenlabs-tools'
import type { ToolSyncPlan } from './elevenlabs-tool-sync'
import {
  applyToolSync,
  isPluginTool,
  planToolSync,
  pluginToolConfig,
  syncPluginTools
} from './elevenlabs-tool-sync'

function plugin(overrides: Partial<AdamPlugin> = {}): AdamPlugin {
  return {
    name: 'weather',
    description: 'Reads the weather.',
    parameters: { type: 'object', properties: { city: { type: 'string' } } },
    run: async () => 'sunny',
    sourcePath: '/plugins/weather.mjs',
    ...overrides
  }
}

function remoteTool(overrides: Partial<ToolSummary> = {}): ToolSummary {
  return {
    id: 'tool_weather',
    name: 'plugin_weather',
    description: 'Reads the weather.',
    parameters: { type: 'object', properties: { city: { type: 'string' } } },
    ...overrides
  }
}

/** Every tool on the account that this build must never touch. */
const FOREIGN_TOOLS: ToolSummary[] = [
  { id: 't1', name: 'ask_adam', description: 'Ask ADAM.', parameters: { type: 'object' } },
  { id: 't2', name: 'get_context', description: 'Context.', parameters: { type: 'object' } },
  { id: 't3', name: 'run_dobius', description: 'CLI.', parameters: { type: 'object' } },
  { id: 't4', name: 'propose_shell', description: 'Shell.', parameters: { type: 'object' } },
  { id: 't5', name: 'remember', description: 'Memory.', parameters: { type: 'object' } },
  { id: 't6', name: 'forget', description: 'Memory.', parameters: { type: 'object' } },
  { id: 't7', name: 'something_carson_made', description: 'His.', parameters: { type: 'object' } }
]

describe('planToolSync', () => {
  it('creates a tool for a plugin the agent does not have', () => {
    const plan = planToolSync([plugin()], [])
    expect(plan.create.map((config) => config.name)).toEqual(['plugin_weather'])
    expect(plan.update).toEqual([])
    expect(plan.remove).toEqual([])
  })

  it('leaves an unchanged tool completely alone', () => {
    const plan = planToolSync([plugin()], [remoteTool()])
    // No wasted write: a matching tool is neither created nor updated.
    expect(plan).toEqual({ create: [], update: [], remove: [] })
  })

  it('updates a tool whose description changed', () => {
    const plan = planToolSync([plugin({ description: 'Now with wind.' })], [remoteTool()])
    expect(plan.update).toHaveLength(1)
    expect(plan.update[0].id).toBe('tool_weather')
    expect(plan.update[0].config.description).toBe('Now with wind.')
  })

  it('updates a tool whose parameters changed', () => {
    const plan = planToolSync(
      [plugin({ parameters: { type: 'object', properties: { zip: { type: 'string' } } } })],
      [remoteTool()]
    )
    expect(plan.update).toHaveLength(1)
  })

  it('deletes a plugin tool whose plugin is gone', () => {
    const plan = planToolSync([], [remoteTool()])
    expect(plan.remove.map((tool) => tool.name)).toEqual(['plugin_weather'])
  })
})

describe('planToolSync — ownership is the prefix, not a list', () => {
  it('never proposes deleting ask_adam, even with no plugins at all', () => {
    // The named regression from the build file: an empty plugin folder must not
    // strip the agent of every tool this build did not create.
    const plan = planToolSync([], FOREIGN_TOOLS)
    expect(plan.remove).toEqual([])
    expect(plan.create).toEqual([])
    expect(plan.update).toEqual([])
  })

  it('leaves a tool Carson made himself alone while deleting a stale plugin tool', () => {
    // The discriminator is the prefix, so a name nobody hardcoded is still safe.
    const plan = planToolSync([], [...FOREIGN_TOOLS, remoteTool()])
    expect(plan.remove.map((tool) => tool.name)).toEqual(['plugin_weather'])
  })

  it('does not treat a foreign tool as an update candidate', () => {
    const oddlyNamed: ToolSummary = { id: 't9', name: 'weather', description: 'stale' }
    const plan = planToolSync([plugin()], [oddlyNamed])
    // `weather` is not `plugin_weather`, so it is neither updated nor removed —
    // it is simply not ours.
    expect(plan.update).toEqual([])
    expect(plan.remove).toEqual([])
    expect(plan.create.map((config) => config.name)).toEqual(['plugin_weather'])
  })
})

describe('isPluginTool / pluginToolConfig', () => {
  it('recognises only prefixed names', () => {
    expect(isPluginTool('plugin_weather')).toBe(true)
    expect(isPluginTool('ask_adam')).toBe(false)
    expect(isPluginTool('remember')).toBe(false)
  })

  it('builds a client tool config from a plugin', () => {
    expect(pluginToolConfig(plugin())).toEqual({
      name: 'plugin_weather',
      description: 'Reads the weather.',
      expects_response: true,
      parameters: { type: 'object', properties: { city: { type: 'string' } } }
    })
  })
})

type Call = { url: string; method: string; body: unknown }

/** A fake ElevenLabs: records every call and answers each endpoint's shape. */
function fakeApi(tools: ToolSummary[], options: { failDelete?: boolean } = {}) {
  const calls: Call[] = []
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : undefined })

    if (url.endsWith('/tools') && method === 'GET') {
      return jsonResponse({
        tools: tools.map((tool) => ({
          id: tool.id,
          tool_config: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
          }
        }))
      })
    }
    if (url.endsWith('/tools') && method === 'POST') {
      return jsonResponse({ id: 'tool_new' })
    }
    if (method === 'DELETE') {
      return options.failDelete
        ? new Response('nope', { status: 500 })
        : jsonResponse({ ok: true })
    }
    if (url.includes('/agents/')) {
      return method === 'GET'
        ? jsonResponse({
            conversation_config: {
              agent: { prompt: { prompt: 'You are ADAM.', tool_ids: ['t1', 'tool_weather'] } }
            }
          })
        : jsonResponse({ ok: true })
    }
    return jsonResponse({ ok: true })
  }) as unknown as typeof fetch

  return { calls, fetchImpl }
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

describe('syncPluginTools', () => {
  it('creates a missing tool and attaches it in one PATCH', async () => {
    const { calls, fetchImpl } = fakeApi(FOREIGN_TOOLS)
    const report = await syncPluginTools('sk_key', 'agent_1', [plugin()], fetchImpl)
    expect(report.created).toEqual(['plugin_weather'])
    expect(report.errors).toEqual([])

    const patches = calls.filter((call) => call.method === 'PATCH')
    expect(patches).toHaveLength(1)
    const body = patches[0].body as {
      conversation_config: { agent: { prompt: { tool_ids: string[]; prompt: string } } }
    }
    expect(body.conversation_config.agent.prompt.tool_ids).toContain('tool_new')
    // The system prompt must survive: this PATCHes a live agent.
    expect(body.conversation_config.agent.prompt.prompt).toBe('You are ADAM.')
  })

  it('detaches a deleted tool id from the agent', async () => {
    const { calls, fetchImpl } = fakeApi([...FOREIGN_TOOLS, remoteTool()])
    const report = await syncPluginTools('sk_key', 'agent_1', [], fetchImpl)
    expect(report.removed).toEqual(['plugin_weather'])

    const patch = calls.find((call) => call.method === 'PATCH')
    expect(patch).toBeDefined()
    const ids = (
      patch!.body as { conversation_config: { agent: { prompt: { tool_ids: string[] } } } }
    ).conversation_config.agent.prompt.tool_ids
    // Leaving the id attached would point the agent at a tool that is gone.
    expect(ids).not.toContain('tool_weather')
    expect(ids).toContain('t1')
  })

  it('makes NO destructive call when there are no plugins and no plugin tools', async () => {
    const { calls, fetchImpl } = fakeApi(FOREIGN_TOOLS)
    const report = await syncPluginTools('sk_key', 'agent_1', [], fetchImpl)
    expect(report).toEqual({ created: [], updated: [], removed: [], errors: [] })
    expect(calls.filter((call) => call.method === 'DELETE')).toEqual([])
    // Nothing changed, so the agent is not PATCHed at all.
    expect(calls.filter((call) => call.method === 'PATCH')).toEqual([])
  })

  it('does nothing at all without credentials', async () => {
    const { calls, fetchImpl } = fakeApi(FOREIGN_TOOLS)
    const report = await syncPluginTools('', '', [plugin()], fetchImpl)
    expect(report.errors).toEqual([])
    expect(calls).toEqual([])
  })

  it('reports a failing delete instead of throwing', async () => {
    const { fetchImpl } = fakeApi([remoteTool()], { failDelete: true })
    const report = await syncPluginTools('sk_key', 'agent_1', [], fetchImpl)
    expect(report.removed).toEqual([])
    expect(report.errors[0]).toContain('delete plugin_weather')
  })

  it('treats a 404 on delete as already gone', async () => {
    const fetchImpl = (async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      if (url.endsWith('/tools') && method === 'GET') {
        return jsonResponse({
          tools: [{ id: 'tool_weather', tool_config: { name: 'plugin_weather' } }]
        })
      }
      if (method === 'DELETE') {
        return new Response('gone', { status: 404 })
      }
      return jsonResponse({
        conversation_config: { agent: { prompt: { tool_ids: [] } } }
      })
    }) as unknown as typeof fetch
    const report = await syncPluginTools('sk_key', 'agent_1', [], fetchImpl)
    expect(report.removed).toEqual(['plugin_weather'])
    expect(report.errors).toEqual([])
  })
})

describe('INVARIANT — the executor refuses a poisoned plan', () => {
  it('will not delete a non-prefixed tool even when handed one directly', async () => {
    // The second layer, driven for real. The planner filters by prefix, so the
    // ONLY way to reach this guard is with a plan the planner would never
    // produce — which is exactly what a future edit to the planner would create.
    // Deleting ask_adam off a live account cannot be undone from here.
    const { calls, fetchImpl } = fakeApi(FOREIGN_TOOLS)
    const poisoned: ToolSyncPlan = {
      create: [],
      update: [],
      remove: [
        { id: 't1', name: 'ask_adam' },
        { id: 't7', name: 'something_carson_made' }
      ]
    }
    const report = await applyToolSync('sk_key', 'agent_1', poisoned, fetchImpl)

    expect(calls.filter((call) => call.method === 'DELETE')).toEqual([])
    expect(report.removed).toEqual([])
    expect(report.errors).toEqual([
      'refused to delete ask_adam: not a plugin tool',
      'refused to delete something_carson_made: not a plugin tool'
    ])
  })

  it('still deletes the prefixed tools in a mixed plan', async () => {
    // Guards against the refusal being so broad it stops the sync working.
    const { calls, fetchImpl } = fakeApi([...FOREIGN_TOOLS, remoteTool()])
    const mixed: ToolSyncPlan = {
      create: [],
      update: [],
      remove: [{ id: 't1', name: 'ask_adam' }, remoteTool()]
    }
    const report = await applyToolSync('sk_key', 'agent_1', mixed, fetchImpl)

    expect(report.removed).toEqual(['plugin_weather'])
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1)
  })
})
