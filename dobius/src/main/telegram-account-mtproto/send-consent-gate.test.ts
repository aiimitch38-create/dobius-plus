import { describe, expect, it, vi } from 'vitest'
import { createGramJsPersonalTelegramClientFactory } from './telegram-factory'
import { fakeRuntime, fakeState } from './personal-client.test-support'

describe('MTProto final send authority', () => {
  it('does not invoke SendMessage if consent changes during peer resolution', async () => {
    const state = fakeState()
    const runtime = fakeRuntime(state)
    const sdk = runtime.createClient(null, 12345, 'a'.repeat(32))
    let release!: () => void
    const paused = new Promise<void>((done) => {
      release = done
    })
    sdk.getEntity = vi.fn(async () => {
      await paused
      return state.peer as never
    }) as never
    runtime.createClient = () => sdk
    const client = createGramJsPersonalTelegramClientFactory(
      { apiId: 12345, apiHash: 'a'.repeat(32) },
      runtime
    )(null)
    const signal = new AbortController().signal
    await client.connect(state.session, signal)
    let allowed = true
    const pending = client.sendText({
      groupId: '-42',
      text: 'Approved reply',
      randomId: '123',
      signal,
      canSend: () => allowed
    })
    await vi.waitFor(() => expect(sdk.getEntity).toHaveBeenCalledOnce())
    allowed = false
    release()
    await expect(pending).resolves.toBe('not-sent')
    expect(state.sentRequests).toEqual([])
  })
})
