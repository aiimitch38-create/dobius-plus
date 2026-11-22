import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { DobiusRuntimeService } from '../../dobius-runtime'

vi.mock('./crew-confirm', () => ({ appConfirmationGate: vi.fn() }))

import { buildAccountMethods } from './accounts'
import { createConfirmationGate } from './confirm-gate'

const confirm = vi.fn<(request: { message: string }, signal: AbortSignal) => Promise<boolean>>()
const runtime = {
  getRuntimeId: () => 'test-runtime',
  getAccountsSnapshot: () => ({
    claude: { accounts: [{ id: 'a1', email: 'work@example.com' }], activeAccountId: null },
    codex: { accounts: [], activeAccountId: null }
  }),
  selectClaudeAccount: vi.fn(async () => ({ ok: true })),
  selectCodexAccount: vi.fn(async () => ({ ok: true }))
} as unknown as DobiusRuntimeService & {
  selectClaudeAccount: ReturnType<typeof vi.fn>
  selectCodexAccount: ReturnType<typeof vi.fn>
}
const methods = [...buildAccountMethods(createConfirmationGate(confirm, { cooldownMs: 0 }))]

async function call(method: string, params: unknown, mobile = false) {
  const request: RpcRequest = { id: 'req-1', authToken: 'tok', method, params }
  const dispatcher = new RpcDispatcher({ runtime, methods })
  if (!mobile) {
    return dispatcher.dispatch(request)
  }
  // Paired phones arrive through the WebSocket path, which stamps clientKind.
  const replies: string[] = []
  await dispatcher.dispatchStreaming(request, (reply) => replies.push(reply), {
    clientKind: 'mobile'
  })
  return JSON.parse(replies[0])
}

describe('account switching over RPC', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    confirm.mockResolvedValue(true)
  })

  it('asks in the app first and names the account', async () => {
    expect(await call('accounts.selectClaude', { accountId: 'a1' })).toMatchObject({ ok: true })
    expect(confirm.mock.calls[0][0].message).toContain('work@example.com')
    expect(runtime.selectClaudeAccount).toHaveBeenCalledWith('a1')
  })

  it('switches nothing when Carson cancels', async () => {
    confirm.mockResolvedValue(false)
    expect(await call('accounts.selectCodex', { accountId: null })).toMatchObject({ ok: false })
    expect(await call('accounts.selectClaude', { accountId: 'a1' })).toMatchObject({ ok: false })
    expect(runtime.selectCodexAccount).not.toHaveBeenCalled()
    expect(runtime.selectClaudeAccount).not.toHaveBeenCalled()
  })

  it('does not ask a paired phone (that switch is Carson’s own tap)', async () => {
    await call('accounts.selectClaude', { accountId: 'a1' }, true)
    expect(confirm).not.toHaveBeenCalled()
    expect(runtime.selectClaudeAccount).toHaveBeenCalledWith('a1')
  })
})
