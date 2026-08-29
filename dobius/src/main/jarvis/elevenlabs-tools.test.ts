import { describe, expect, it, vi } from 'vitest'
import {
  PROPOSE_SHELL_TOOL,
  createClientTool,
  ensureClientTool,
  getAgentPrompt,
  listClientTools
} from './elevenlabs-tools'

type Route = { status?: number; body: unknown }

/** A fake ElevenLabs keyed by "METHOD /path-suffix", recording every call. */
function fakeApi(routes: Record<string, Route>): {
  fetchImpl: typeof fetch
  calls: { key: string; body: unknown }[]
} {
  const calls: { key: string; body: unknown }[] = []
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const path = String(url).replace('https://api.elevenlabs.io/v1/convai', '')
    const key = `${init?.method ?? 'GET'} ${path}`
    calls.push({ key, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const route = routes[key]
    if (!route) {
      return { ok: false, status: 404, text: async () => 'no route', json: async () => ({}) }
    }
    return {
      ok: (route.status ?? 200) < 400,
      status: route.status ?? 200,
      text: async () => JSON.stringify(route.body),
      json: async () => route.body
    }
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

const AGENT = '/agents/agent_1'

describe('PROPOSE_SHELL_TOOL', () => {
  it('declares parameters as a JSON-Schema OBJECT, not an array', () => {
    // An array is accepted by the API and then never invoked by the model,
    // which looks like the agent ignoring the tool rather than a config bug.
    expect(Array.isArray(PROPOSE_SHELL_TOOL.parameters)).toBe(false)
    expect(PROPOSE_SHELL_TOOL.parameters.type).toBe('object')
    expect(PROPOSE_SHELL_TOOL.parameters.properties).toHaveProperty('command')
  })

  it('tells the agent it cannot approve its own command', () => {
    expect(PROPOSE_SHELL_TOOL.description).toMatch(/cannot approve it yourself/i)
  })
})

describe('listClientTools', () => {
  it('reads id and name out of the tool_config envelope', async () => {
    const { fetchImpl } = fakeApi({
      'GET /tools': { body: { tools: [{ id: 't1', tool_config: { name: 'ask_adam' } }] } }
    })
    const result = await listClientTools('key', fetchImpl)
    expect(result).toEqual({ ok: true, value: [{ id: 't1', name: 'ask_adam' }] })
  })

  it('reports an API error instead of pretending there are no tools', async () => {
    const { fetchImpl } = fakeApi({ 'GET /tools': { status: 401, body: {} } })
    const result = await listClientTools('key', fetchImpl)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('convai_write')
    }
  })
})

describe('createClientTool', () => {
  it('posts the tool_config envelope with type client', async () => {
    const { fetchImpl, calls } = fakeApi({ 'POST /tools': { body: { id: 't9' } } })
    const result = await createClientTool('key', PROPOSE_SHELL_TOOL, fetchImpl)
    expect(result).toEqual({ ok: true, value: 't9' })
    expect(calls[0].body).toMatchObject({
      tool_config: { type: 'client', name: 'propose_shell', expects_response: true }
    })
  })
})

describe('ensureClientTool', () => {
  it('creates and attaches when the tool does not exist', async () => {
    const { fetchImpl, calls } = fakeApi({
      'GET /tools': { body: { tools: [] } },
      'POST /tools': { body: { id: 't9' } },
      [`GET ${AGENT}`]: {
        body: {
          conversation_config: {
            agent: { prompt: { prompt: 'You are Adam.', llm: 'gpt-4o', tool_ids: ['t1'] } }
          }
        }
      },
      [`PATCH ${AGENT}`]: { body: {} }
    })
    const result = await ensureClientTool('key', 'agent_1', PROPOSE_SHELL_TOOL, fetchImpl)
    expect(result).toEqual({ ok: true, value: { id: 't9', created: true, attached: true } })

    const patch = calls.find((call) => call.key === `PATCH ${AGENT}`)
    // Appends rather than replaces — a fresh list would detach ask_adam.
    // And carries the rest of the prompt back, so that if the API replaces the
    // prompt object instead of merging it, the system prompt and LLM survive.
    expect(patch?.body).toEqual({
      conversation_config: {
        agent: {
          prompt: { prompt: 'You are Adam.', llm: 'gpt-4o', tool_ids: ['t1', 't9'] }
        }
      }
    })
  })

  it('never sends a PATCH that would drop the agent system prompt', async () => {
    const { fetchImpl, calls } = fakeApi({
      'GET /tools': { body: { tools: [{ id: 't5', tool_config: { name: 'propose_shell' } }] } },
      [`GET ${AGENT}`]: {
        body: {
          conversation_config: {
            agent: { prompt: { prompt: 'IRREPLACEABLE', first_message: 'hi', tool_ids: [] } }
          }
        }
      },
      [`PATCH ${AGENT}`]: { body: {} }
    })
    await ensureClientTool('key', 'agent_1', PROPOSE_SHELL_TOOL, fetchImpl)
    const patch = calls.find((call) => call.key === `PATCH ${AGENT}`)
    expect(patch).toBeDefined()
    const body = patch?.body as {
      conversation_config?: { agent?: { prompt?: Record<string, unknown> } }
    }
    const sent = body.conversation_config?.agent?.prompt ?? {}
    expect(sent.prompt).toBe('IRREPLACEABLE')
    expect(sent.first_message).toBe('hi')
  })

  it('does not create a duplicate when the tool already exists', async () => {
    const { fetchImpl, calls } = fakeApi({
      'GET /tools': { body: { tools: [{ id: 't5', tool_config: { name: 'propose_shell' } }] } },
      [`GET ${AGENT}`]: { body: { conversation_config: { agent: { prompt: { tool_ids: ['t5'] } } } } }
    })
    const result = await ensureClientTool('key', 'agent_1', PROPOSE_SHELL_TOOL, fetchImpl)
    expect(result).toEqual({ ok: true, value: { id: 't5', created: false, attached: false } })
    expect(calls.some((call) => call.key === 'POST /tools')).toBe(false)
    expect(calls.some((call) => call.key === `PATCH ${AGENT}`)).toBe(false)
  })

  it('attaches an existing but unattached tool', async () => {
    const { fetchImpl } = fakeApi({
      'GET /tools': { body: { tools: [{ id: 't5', tool_config: { name: 'propose_shell' } }] } },
      [`GET ${AGENT}`]: { body: { conversation_config: { agent: { prompt: { tool_ids: [] } } } } },
      [`PATCH ${AGENT}`]: { body: {} }
    })
    const result = await ensureClientTool('key', 'agent_1', PROPOSE_SHELL_TOOL, fetchImpl)
    expect(result).toEqual({ ok: true, value: { id: 't5', created: false, attached: true } })
  })

  it('refuses without credentials rather than calling the API', async () => {
    const { fetchImpl, calls } = fakeApi({})
    expect((await ensureClientTool('', 'agent_1', PROPOSE_SHELL_TOOL, fetchImpl)).ok).toBe(false)
    expect((await ensureClientTool('key', '', PROPOSE_SHELL_TOOL, fetchImpl)).ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('surfaces an API failure instead of swallowing it', async () => {
    const { fetchImpl } = fakeApi({
      'GET /tools': { body: { tools: [] } },
      'POST /tools': { status: 500, body: { detail: 'boom' } }
    })
    const result = await ensureClientTool('key', 'agent_1', PROPOSE_SHELL_TOOL, fetchImpl)
    expect(result.ok).toBe(false)
  })

  it('does not throw when the network is down', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ENOTFOUND')
    }) as unknown as typeof fetch
    const result = await ensureClientTool('key', 'agent_1', PROPOSE_SHELL_TOOL, fetchImpl)
    expect(result.ok).toBe(false)
  })
})

describe('getAgentPrompt', () => {
  it('returns an empty prompt and no tools for an agent with neither', async () => {
    const { fetchImpl } = fakeApi({ [`GET ${AGENT}`]: { body: {} } })
    const result = await getAgentPrompt('key', 'agent_1', fetchImpl)
    expect(result).toEqual({ ok: true, value: { prompt: {}, toolIds: [] } })
  })
})
