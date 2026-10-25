import { describe, expect, it } from 'vitest'
import { AgentPresenceRegistry } from '../../../agents/agent-presence-registry'
import type { DobiusRuntimeService } from '../../dobius-runtime'
import type { RpcRequest, RpcResponse } from '../core'
import { RpcDispatcher } from '../dispatcher'
import { buildAgentControlMethods } from './agent-control'

function request(method: string, params: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

function result(response: RpcResponse): unknown {
  if (!response.ok) {
    throw new Error(JSON.stringify(response.error))
  }
  return response.result
}

describe('board.agentControl / board.agentState', () => {
  it('drives the registry and validates input', async () => {
    const registry = new AgentPresenceRegistry(() => 5_000)
    const dispatcher = new RpcDispatcher({
      runtime: { getRuntimeId: () => 'test-runtime' } as unknown as DobiusRuntimeService,
      methods: buildAgentControlMethods(registry)
    })
    const paused = await dispatcher.dispatch(
      request('board.agentControl', { agentId: 'adam', action: 'pause' })
    )
    expect(result(paused)).toMatchObject({ ok: true, state: { paused: true } })
    expect(registry.clearance('adam', 't1')).toBe('paused')

    // Why: yields are human input and have no RPC twin; only the Board window's
    // `agents:yield` IPC may mark a tile as human-held.
    const yielded = await dispatcher.dispatch(request('board.agentYield', { cardId: 'card-1' }))
    expect(yielded.ok).toBe(false)
    expect(registry.isYielding('card-1')).toBe(false)

    const state = await dispatcher.dispatch(request('board.agentState', { agentId: 'adam' }))
    expect(result(state)).toEqual({
      agentId: 'adam',
      state: { paused: true, stopped: false, takenOverUntil: 0 }
    })

    // Why: an agent must never be able to undo the human's stop/pause or answer a gate over RPC.
    for (const action of ['resume', 'takeOver', 'approve', 'deny']) {
      const response = await dispatcher.dispatch(
        request('board.agentControl', { agentId: 'adam', action, requestId: 'g1' })
      )
      expect(response.ok, action).toBe(false)
    }
    expect(registry.getState('adam').paused).toBe(true)

    for (const [method, params] of [
      ['board.agentControl', { agentId: 'Adam', action: 'pause' }],
      ['board.agentControl', { agentId: 'adam', action: 'pause', requestId: 'g1' }],
      ['board.agentControl', { agentId: 'adam', action: 'explode' }],
      ['board.agentControl', { agentId: 'adam', action: 'pause', extra: true }]
    ] as const) {
      const response = await dispatcher.dispatch(request(method, params))
      expect(response.ok, JSON.stringify(params)).toBe(false)
    }
  })
})
