import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenRouterProvider } from './openrouter-provider'

const identityStoreMock = vi.hoisted(() => ({
  ensureAgentIdentity: vi.fn()
}))
vi.mock('../agent-participant-identity-store', () => identityStoreMock)

const API_KEY = 'sk-or-v1-never-leaks'

function reply(content: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] })
  } as unknown as Response
}

function setup(fetchImpl: typeof globalThis.fetch) {
  const provider = new OpenRouterProvider('agent-1', 'Router', {
    fetch: fetchImpl,
    readApiKey: () => API_KEY
  })
  const events: unknown[] = []
  provider.subscribe((event) => events.push(event))
  return { provider, events }
}

beforeEach(() => {
  identityStoreMock.ensureAgentIdentity.mockReset()
  identityStoreMock.ensureAgentIdentity.mockReturnValue({ pubkey: 'router-pubkey' })
})

describe('OpenRouterProvider', () => {
  it('launch binds an identity and returns a run id', async () => {
    const { provider } = setup(vi.fn(async () => reply('hello')) as unknown as typeof fetch)
    const result = await provider.launch({ agentId: 'agent-1', prompt: 'hi' })
    expect(result.identityPubkey).toBe('router-pubkey')
    expect(result.runId).toBeTruthy()
    expect(provider.status().state).toBe('finished')
  })

  it('sends the key as a bearer header', async () => {
    const doFetch = vi.fn(async () => reply('ok')) as unknown as typeof fetch
    const { provider } = setup(doFetch)
    await provider.launch({ agentId: 'agent-1', prompt: 'hi' })
    const init = (doFetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0][1]
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${API_KEY}`)
  })

  it('keeps the thread so a follow-up continues the conversation', async () => {
    const doFetch = vi.fn(async () => reply('second')) as unknown as typeof fetch
    const { provider } = setup(doFetch)
    await provider.launch({ agentId: 'agent-1', prompt: 'first' })
    await provider.send('follow up')

    const body = JSON.parse(
      ((doFetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[1][1]
        .body ?? '') as string
    ) as { messages: { role: string; content: string }[] }
    expect(body.messages.map((m) => m.content)).toEqual(['first', 'second', 'follow up'])
  })

  it('never puts the key in a status detail on failure', async () => {
    const doFetch = vi.fn(async () => ({ ok: false, status: 401 }) as unknown as Response)
    const { provider } = setup(doFetch as unknown as typeof fetch)
    await provider.launch({ agentId: 'agent-1', prompt: 'hi' })

    const snapshot = provider.status()
    expect(snapshot.state).toBe('failed')
    expect(snapshot.detail).toContain('401')
    expect(JSON.stringify(snapshot)).not.toContain(API_KEY)
  })

  it('reports a failure rather than throwing', async () => {
    const doFetch = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    const { provider } = setup(doFetch)
    await expect(provider.launch({ agentId: 'agent-1', prompt: 'hi' })).resolves.toBeTruthy()
    expect(provider.status().state).toBe('failed')
    expect(provider.status().detail).toBe('network down')
  })

  it('rejects an empty follow-up', async () => {
    const { provider } = setup(vi.fn(async () => reply('ok')) as unknown as typeof fetch)
    await provider.launch({ agentId: 'agent-1', prompt: 'hi' })
    await expect(provider.send('   ')).rejects.toThrow(/required/)
  })
})
