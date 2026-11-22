import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { DobiusRuntimeService } from '../../dobius-runtime'

// Why: jarvis-ipc.ts and crew-confirm.ts import electron at module scope.
vi.mock('../../../jarvis/jarvis-ipc', () => ({
  askAdam: vi.fn(),
  isAdamBusy: vi.fn(() => false),
  jarvisVoiceControls: vi.fn(() => null)
}))
vi.mock('./crew-confirm', () => ({ appConfirmationGate: vi.fn() }))

import { ADAM_BUSY_TEXT } from '../../../jarvis/adam-conversation'
import { buildAdamMethods, type AdamMethodDeps } from './adam'
import { createConfirmationGate } from './confirm-gate'

const runtime = { getRuntimeId: () => 'test-runtime' } as unknown as DobiusRuntimeService

const confirm =
  vi.fn<
    (
      request: { title: string; message: string; detail: string },
      signal: AbortSignal
    ) => Promise<boolean>
  >()
let busy = false
const ask = vi.fn<AdamMethodDeps['ask']>()
const voice = {
  status: vi.fn(() => ({ shortcutActive: true, phase: 'idle' as never })),
  setMode: vi.fn((active: boolean) => ({ ok: active })),
  speak: vi.fn(async () => ({ played: true }))
}
let voiceReady = true
const methods = buildAdamMethods(createConfirmationGate(confirm, { cooldownMs: 0 }), {
  isBusy: () => busy,
  ask,
  voice: () => (voiceReady ? voice : null)
})

function call(method: string, params?: unknown) {
  const request: RpcRequest = { id: 'req-1', authToken: 'tok', method, params }
  return new RpcDispatcher({ runtime, methods }).dispatch(request)
}

describe('adam RPC methods', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    busy = false
    voiceReady = true
    confirm.mockResolvedValue(true)
    ask.mockResolvedValue({ kind: 'answer', text: 'Two consoles are running.' } as never)
  })

  it('asks the one ADAM after the human confirms, with a cli turn and encoded text', async () => {
    const response = await call('adam.ask', {
      text: 'what is <running>?',
      source: 'codex-worker',
      wait: true
    })
    expect(response).toMatchObject({
      ok: true,
      result: { sent: true, waited: true, reply: { text: 'Two consoles are running.' } }
    })
    expect(confirm).toHaveBeenCalledOnce()
    expect(confirm.mock.calls[0][0].detail).toContain('what is <running>?')
    expect(confirm.mock.calls[0][0].detail).toContain('Sent by: codex-worker')
    const [prompt, options] = ask.mock.calls[0]
    expect(options).toEqual({
      source: 'cli',
      said: '(sent with dobius adam ask by codex-worker) what is <running>?'
    })
    // The caller's words sit in a JSON string with < and > escaped, never raw.
    expect(prompt).toContain('"what is \\u003crunning\\u003e?"')
    expect(prompt).not.toContain('<running>')
  })

  it('returns at once without --wait and leaves the reply to the thread', async () => {
    let finish: (value: never) => void = () => undefined
    ask.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const response = await call('adam.ask', { text: 'hello' })
    expect(response).toMatchObject({ ok: true, result: { sent: true, waited: false } })
    expect(ask).toHaveBeenCalledOnce()
    finish({ kind: 'answer', text: 'hi' } as never)
  })

  it('sends nothing when the dialog is declined', async () => {
    confirm.mockResolvedValue(false)
    const response = await call('adam.ask', { text: 'hello' })
    expect(response).toMatchObject({ ok: false })
    expect(JSON.stringify(response)).toContain('Not confirmed in Dobius+')
    expect(ask).not.toHaveBeenCalled()
  })

  it('refuses while ADAM is busy, before any dialog', async () => {
    busy = true
    const response = await call('adam.ask', { text: 'hello' })
    expect(JSON.stringify(response)).toContain(ADAM_BUSY_TEXT)
    expect(confirm).not.toHaveBeenCalled()
    expect(ask).not.toHaveBeenCalled()
  })

  it('re-checks busy after the dialog closes', async () => {
    confirm.mockImplementation(async () => {
      busy = true
      return true
    })
    const response = await call('adam.ask', { text: 'hello' })
    expect(JSON.stringify(response)).toContain(ADAM_BUSY_TEXT)
    expect(ask).not.toHaveBeenCalled()
  })

  it('refuses text the dialog could not show in full and odd source labels', async () => {
    expect(await call('adam.ask', { text: 'x'.repeat(1501) })).toMatchObject({ ok: false })
    expect(await call('adam.ask', { text: 'hi', source: '<script>' })).toMatchObject({
      ok: false
    })
    expect(await call('adam.ask', { text: '   ' })).toMatchObject({ ok: false })
    expect(confirm).not.toHaveBeenCalled()
  })

  it('reports status, speaks and sets voice mode through the window service', async () => {
    expect(await call('adam.status')).toMatchObject({
      ok: true,
      result: { busy: false, voiceReady: true, shortcutActive: true, phase: 'idle' }
    })
    expect(await call('adam.say', { text: 'Done.' })).toMatchObject({
      ok: true,
      result: { played: true }
    })
    expect(voice.speak).toHaveBeenCalledWith('Done.')
    expect(await call('adam.setMode', { active: false })).toMatchObject({
      ok: true,
      result: { active: false, ok: false }
    })
    expect(voice.setMode).toHaveBeenCalledWith(false)
  })

  it('says voice is not ready before the window set it up', async () => {
    voiceReady = false
    expect(await call('adam.status')).toMatchObject({ ok: true, result: { voiceReady: false } })
    expect(JSON.stringify(await call('adam.say', { text: 'hi' }))).toContain('not ready')
  })
})
