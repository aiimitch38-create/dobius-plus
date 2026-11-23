import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { DobiusRuntimeService } from '../../dobius-runtime'
import { adamCallerId } from '../../../jarvis/adam-caller-id'
import { AdamNotifier } from '../../../jarvis/adam-notify'
import { adamHermesEnvironment } from '../../../jarvis/adam-hermes-runtime'
import { ADAM_NOTIFY_ONLY_ADAM, buildAdamNotifyMethods } from './adam-notify'

const runtime = { getRuntimeId: () => 'test-runtime' } as unknown as DobiusRuntimeService
const showNotification = vi.fn()
const notifier = new AdamNotifier({
  enabled: () => true,
  appendThread: async () => undefined,
  sayLive: () => false,
  showNotification
})
const methods = buildAdamNotifyMethods(() => notifier)

function call(params: unknown, options: Parameters<RpcDispatcher['dispatch']>[1] = { authenticatedLocal: true }) {
  const request: RpcRequest = { id: 'req-1', authToken: 'tok', method: 'adam.notify', params }
  return new RpcDispatcher({ runtime, methods }).dispatch(request, options)
}

const valid = (): Record<string, unknown> => ({
  text: 'The release is waiting on you.',
  caller: 'adam',
  callerId: adamCallerId()
})

describe('adam.notify RPC', () => {
  it('hands ADAM the caller id through his Hermes environment only', () => {
    const env = adamHermesEnvironment({ python: '/p', root: '/r', profileHome: '/h/profiles/adam' })
    expect(env.DOBIUS_ADAM_CALLER_ID).toBe(adamCallerId())
    expect(process.env.DOBIUS_ADAM_CALLER_ID).toBeUndefined()
  })

  it('rotates the id on every Hermes spawn, so an old one stops working', async () => {
    const old = adamHermesEnvironment({ python: '/p', root: '/r', profileHome: '/h' })
      .DOBIUS_ADAM_CALLER_ID
    const next = adamHermesEnvironment({ python: '/p', root: '/r', profileHome: '/h' })
      .DOBIUS_ADAM_CALLER_ID
    expect(next).not.toBe(old)
    expect(await call({ ...valid(), callerId: old })).toMatchObject({ ok: false })
  })

  it('delivers for ADAM over the local socket', async () => {
    const response = await call(valid())
    expect(response).toMatchObject({ ok: true, result: { delivered: 'notification' } })
    expect(showNotification).toHaveBeenCalledWith('ADAM', 'The release is waiting on you.')
  })

  it('refuses a wrong or missing caller id, the agent key, and anything not local', async () => {
    for (const [params, options] of [
      [{ ...valid(), callerId: 'forged' }, { authenticatedLocal: true }],
      [valid(), { authenticatedLocal: true, agentKey: true }],
      [valid(), {}]
    ] as const) {
      const response = await call(params, options)
      expect(response).toMatchObject({ ok: false })
      expect(JSON.stringify(response)).toContain(ADAM_NOTIFY_ONLY_ADAM)
    }
  })

  it('refuses a caller that is not adam, hidden characters and text over 300', async () => {
    for (const params of [
      { ...valid(), caller: 'codex' },
      { ...valid(), text: 'hi​there' },
      { ...valid(), text: 'x'.repeat(301) },
      { ...valid(), extra: true }
    ]) {
      expect(await call(params)).toMatchObject({ ok: false })
    }
  })
})
