import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { DobiusRuntimeService } from '../../dobius-runtime'
import { adamCallerId } from '../../../jarvis/adam-caller-id'
import { memoryIntakeStore } from '../../../text-intake/intake-store'
import { TextIntake } from '../../../text-intake/text-intake'
import { ADAM_DRAFT_TEXT_ONLY_ADAM, buildAdamDraftTextMethods } from './adam-draft-text'

const runtime = { getRuntimeId: () => 'test-runtime' } as unknown as DobiusRuntimeService
const sendText = vi.fn(async () => undefined)
const intake = new TextIntake({
  store: memoryIntakeStore({ contacts: [{ name: 'Brett', handle: '+15550102000' }] }),
  createCard: () => ({ id: 't' }),
  sendText,
  sendUnavailable: () => null,
  authorizeSend: async () => null,
  appendThread: async () => undefined,
  tap: () => undefined
})
const methods = buildAdamDraftTextMethods(() => intake)

function call(params: unknown, options: Parameters<RpcDispatcher['dispatch']>[1] = { authenticatedLocal: true }) {
  const request: RpcRequest = { id: 'req-1', authToken: 'tok', method: 'adam.draftText', params }
  return new RpcDispatcher({ runtime, methods }).dispatch(request, options)
}

const valid = (): Record<string, unknown> => ({
  to: 'Brett',
  text: 'Carson will call you at 3.',
  caller: 'adam',
  callerId: adamCallerId()
})

describe('adam.draftText RPC', () => {
  it('makes a draft for ADAM and never sends', async () => {
    const response = await call(valid())
    expect(response).toMatchObject({
      ok: true,
      result: { toName: 'Brett', toHandle: '+15550102000', sent: false }
    })
    expect(sendText).not.toHaveBeenCalled()
    expect(intake.view().drafts).toHaveLength(1)
  })

  it('refuses a forged or missing caller id, the agent key and anything not local (a phone included)', async () => {
    for (const [params, options] of [
      [{ ...valid(), callerId: 'forged' }, { authenticatedLocal: true }],
      [{ ...valid(), callerId: '' }, { authenticatedLocal: true }],
      [valid(), { authenticatedLocal: true, agentKey: true }],
      [valid(), {}]
    ] as const) {
      const response = await call(params, options)
      expect(response).toMatchObject({ ok: false })
      expect(JSON.stringify(response)).toContain(ADAM_DRAFT_TEXT_ONLY_ADAM)
    }
  })

  it('refuses a recipient who is not tracked, hidden characters and extra fields', async () => {
    const before = intake.view().drafts.length
    for (const params of [
      { ...valid(), to: 'Zach' },
      { ...valid(), to: '+15559999999' },
      { ...valid(), text: 'hi​there' },
      { ...valid(), caller: 'codex' },
      { ...valid(), send: true }
    ]) {
      expect(await call(params)).toMatchObject({ ok: false })
    }
    expect(intake.view().drafts).toHaveLength(before)
    expect(sendText).not.toHaveBeenCalled()
  })
})
