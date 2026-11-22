import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { DobiusRuntimeService } from '../../dobius-runtime'

vi.mock('./crew-confirm', () => ({ appConfirmationGate: vi.fn() }))

import { buildTelegramReplyMethods } from './telegram-replies'
import { createConfirmationGate } from './confirm-gate'
import type { TelegramTerminalAccess } from '../../../telegram-account/terminal-access'

const runtime = { getRuntimeId: () => 'test-runtime' } as unknown as DobiusRuntimeService
const confirm = vi.fn<(request: { title: string }, signal: AbortSignal) => Promise<boolean>>()
const VIEW = {
  account: {
    phase: 'connected',
    connected: true,
    paused: false,
    selectedGroups: [{ id: '-1', title: 'NLD' }],
    drafts: [{ id: 'd1', groupTitle: 'NLD', state: 'pending', createdAt: 1, body: 'secret text' }],
    lastError: null,
    revision: 1
  },
  groups: [],
  audit: [],
  consents: [{ evidence: 'they said yes in person' }],
  replyHandling: { bridge: 'ready', listening: true, policy: 'approval-required' }
}
const replies = {
  start: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
  pause: vi.fn(async () => undefined),
  resume: vi.fn(async () => undefined)
}
const access = { view: vi.fn(async () => VIEW), replies } as unknown as TelegramTerminalAccess
const methods = buildTelegramReplyMethods(
  createConfirmationGate(confirm, { cooldownMs: 0 }),
  () => access
)

function call(method: string, params?: unknown) {
  const request: RpcRequest = { id: 'req-1', authToken: 'tok', method, params }
  return new RpcDispatcher({ runtime, methods }).dispatch(request)
}

describe('telegram reply RPC methods', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    confirm.mockResolvedValue(true)
  })

  it('snapshot leaves out draft text and consent evidence', async () => {
    const response = await call('telegram.snapshot')
    expect(response).toMatchObject({
      ok: true,
      result: { phase: 'connected', consentCount: 1, drafts: [{ id: 'd1', state: 'pending' }] }
    })
    expect(JSON.stringify(response)).not.toContain('secret text')
    expect(JSON.stringify(response)).not.toContain('in person')
  })

  it('start and resume wait for confirmation; declining changes nothing', async () => {
    expect(await call('telegram.replies', { action: 'start' })).toMatchObject({
      ok: true,
      result: { action: 'start' }
    })
    expect(replies.start).toHaveBeenCalledOnce()
    confirm.mockResolvedValue(false)
    expect(await call('telegram.replies', { action: 'resume' })).toMatchObject({ ok: false })
    expect(replies.resume).not.toHaveBeenCalled()
  })

  it('stop and pause switch off without a dialog', async () => {
    await call('telegram.replies', { action: 'stop' })
    await call('telegram.replies', { action: 'pause' })
    expect(replies.stop).toHaveBeenCalledOnce()
    expect(replies.pause).toHaveBeenCalledOnce()
    expect(confirm).not.toHaveBeenCalled()
  })

  it('passes on only the closed list of error codes', async () => {
    replies.stop.mockRejectedValueOnce(new Error('AUTH_KEY abc123 leaked detail'))
    const leaked = JSON.stringify(await call('telegram.replies', { action: 'stop' }))
    expect(leaked).toContain('authorization-failed')
    expect(leaked).not.toContain('abc123')
    replies.stop.mockRejectedValueOnce(new Error('client-unavailable'))
    expect(JSON.stringify(await call('telegram.replies', { action: 'stop' }))).toContain(
      'client-unavailable'
    )
    expect(await call('telegram.replies', { action: 'send' })).toMatchObject({ ok: false })
  })
})
