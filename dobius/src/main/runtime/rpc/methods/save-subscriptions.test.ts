import { describe, expect, it, vi, beforeEach } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { DobiusRuntimeService } from '../../dobius-runtime'

vi.mock('../../../communications/canvas/save-subscription-store', () => ({
  listSaveSubscriptions: vi.fn(),
  createSaveSubscription: vi.fn(),
  deleteSaveSubscription: vi.fn(),
  mergeSaveSubscriptionKinds: vi.fn(),
  removeSaveSubscriptionKind: vi.fn()
}))

import {
  createSaveSubscription,
  deleteSaveSubscription,
  listSaveSubscriptions,
  mergeSaveSubscriptionKinds,
  removeSaveSubscriptionKind
} from '../../../communications/canvas/save-subscription-store'
import { SAVE_SUBSCRIPTION_METHODS } from './save-subscriptions'

const runtime = { getRuntimeId: () => 'test-runtime' } as unknown as DobiusRuntimeService
const RELAY = 'ws://localhost:3300'

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

function makeDispatcher(): RpcDispatcher {
  return new RpcDispatcher({ runtime, methods: SAVE_SUBSCRIPTION_METHODS })
}

describe('save subscription RPC methods', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists subscriptions scoped to the caller identity+relay', async () => {
    const row = { identityPubkey: 'pk-1', relayUrl: RELAY, scopeType: 'channel_h', scopeValue: 'c-1', kinds: [9], createdAt: 1 }
    vi.mocked(listSaveSubscriptions).mockReturnValue([row] as never)

    await expect(
      makeDispatcher().dispatch(makeRequest('saveSubscription.list', { identityPubkey: 'pk-1', relayUrl: RELAY }))
    ).resolves.toMatchObject({ ok: true, result: { subscriptions: [row] } })
    expect(listSaveSubscriptions).toHaveBeenCalledWith('pk-1', RELAY)
  })

  it('rejects a list request missing identityPubkey/relayUrl', async () => {
    await expect(makeDispatcher().dispatch(makeRequest('saveSubscription.list', {}))).resolves.toMatchObject({
      ok: false
    })
    expect(listSaveSubscriptions).not.toHaveBeenCalled()
  })

  it('creates a subscription, defaulting kinds to an empty array when omitted', async () => {
    const created = { identityPubkey: 'pk-1', relayUrl: RELAY, scopeType: 'channel_h', scopeValue: 'c-1', kinds: [], createdAt: 1 }
    vi.mocked(createSaveSubscription).mockReturnValue(created as never)

    await expect(
      makeDispatcher().dispatch(
        makeRequest('saveSubscription.create', { identityPubkey: 'pk-1', relayUrl: RELAY, scopeType: 'channel_h', scopeValue: 'c-1' })
      )
    ).resolves.toMatchObject({ ok: true, result: { subscription: created } })
    expect(createSaveSubscription).toHaveBeenCalledWith('pk-1', RELAY, 'channel_h', 'c-1', [])
  })

  it('rejects create with an invalid scopeType before reaching the store (failure path)', async () => {
    await expect(
      makeDispatcher().dispatch(
        makeRequest('saveSubscription.create', { identityPubkey: 'pk-1', relayUrl: RELAY, scopeType: 'bogus', scopeValue: 'c-1' })
      )
    ).resolves.toMatchObject({ ok: false })
    expect(createSaveSubscription).not.toHaveBeenCalled()
  })

  it('deletes a subscription and reports whether a row was removed', async () => {
    vi.mocked(deleteSaveSubscription).mockReturnValue(true)
    await expect(
      makeDispatcher().dispatch(
        makeRequest('saveSubscription.delete', { identityPubkey: 'pk-1', relayUrl: RELAY, scopeType: 'channel_h', scopeValue: 'c-1' })
      )
    ).resolves.toMatchObject({ ok: true, result: { removed: true } })
  })

  it('merges a kind into the owner_p subscription', async () => {
    const merged = { identityPubkey: 'pk-1', relayUrl: RELAY, scopeType: 'owner_p', scopeValue: 'pk-1', kinds: [24200], createdAt: 1 }
    vi.mocked(mergeSaveSubscriptionKinds).mockReturnValue(merged as never)

    await expect(
      makeDispatcher().dispatch(makeRequest('saveSubscription.mergeKind', { identityPubkey: 'pk-1', relayUrl: RELAY, kind: 24200 }))
    ).resolves.toMatchObject({ ok: true, result: { subscription: merged } })
    expect(mergeSaveSubscriptionKinds).toHaveBeenCalledWith('pk-1', RELAY, 24200)
  })

  it('removes a kind, returning null in the result when the row was deleted entirely', async () => {
    vi.mocked(removeSaveSubscriptionKind).mockReturnValue(null)
    await expect(
      makeDispatcher().dispatch(makeRequest('saveSubscription.removeKind', { identityPubkey: 'pk-1', relayUrl: RELAY, kind: 24200 }))
    ).resolves.toMatchObject({ ok: true, result: { subscription: null } })
  })

  it('rejects a kind mutation missing a numeric kind (failure path)', async () => {
    await expect(
      makeDispatcher().dispatch(makeRequest('saveSubscription.mergeKind', { identityPubkey: 'pk-1', relayUrl: RELAY }))
    ).resolves.toMatchObject({ ok: false })
    expect(mergeSaveSubscriptionKinds).not.toHaveBeenCalled()
  })
})
