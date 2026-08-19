import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const testState = { dir: '' }

vi.mock('electron', () => ({
  app: {
    getPath: () => testState.dir
  }
}))

const RELAY = 'ws://localhost:3300'

describe('save-subscription-store', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'dobius-save-subscription-store-'))
    vi.resetModules()
  })

  afterEach(() => {
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('creates, lists, and deletes a save subscription', async () => {
    const { createSaveSubscription, listSaveSubscriptions, deleteSaveSubscription } = await import('./save-subscription-store')

    expect(listSaveSubscriptions('pk-1', RELAY)).toEqual([])

    const created = createSaveSubscription('pk-1', RELAY, 'channel_h', 'channel-1', [9, 40002])
    expect(created).toMatchObject({ identityPubkey: 'pk-1', relayUrl: RELAY, scopeType: 'channel_h', scopeValue: 'channel-1', kinds: [9, 40002] })

    expect(listSaveSubscriptions('pk-1', RELAY)).toEqual([created])
    expect(listSaveSubscriptions('pk-2', RELAY)).toEqual([])

    expect(deleteSaveSubscription('pk-1', RELAY, 'channel_h', 'channel-1')).toBe(true)
    expect(listSaveSubscriptions('pk-1', RELAY)).toEqual([])
  })

  it('reports false when deleting a subscription that does not exist (failure path)', async () => {
    const { deleteSaveSubscription } = await import('./save-subscription-store')
    expect(deleteSaveSubscription('pk-1', RELAY, 'channel_h', 'channel-1')).toBe(false)
  })

  it('create is an idempotent upsert keyed by identity+relay+scope, not an append', async () => {
    const { createSaveSubscription, listSaveSubscriptions } = await import('./save-subscription-store')
    createSaveSubscription('pk-1', RELAY, 'channel_h', 'channel-1', [9])
    createSaveSubscription('pk-1', RELAY, 'channel_h', 'channel-1', [40002])
    const rows = listSaveSubscriptions('pk-1', RELAY)
    expect(rows).toHaveLength(1)
    expect(rows[0].kinds).toEqual([40002])
  })

  it('rejects an invalid scope type on create (failure path)', async () => {
    const { createSaveSubscription } = await import('./save-subscription-store')
    expect(() => createSaveSubscription('pk-1', RELAY, 'not-real', 'channel-1', [9])).toThrow(
      'Invalid save subscription scope type'
    )
  })

  it('merges a kind into a new owner_p row when none exists yet', async () => {
    const { mergeSaveSubscriptionKinds, listSaveSubscriptions } = await import('./save-subscription-store')
    const record = mergeSaveSubscriptionKinds('pk-1', RELAY, 24200)
    expect(record).toMatchObject({ scopeType: 'owner_p', scopeValue: 'pk-1', kinds: [24200] })
    expect(listSaveSubscriptions('pk-1', RELAY)).toEqual([record])
  })

  it('merges a second kind into the existing owner_p row without dropping the first', async () => {
    const { mergeSaveSubscriptionKinds } = await import('./save-subscription-store')
    mergeSaveSubscriptionKinds('pk-1', RELAY, 24200)
    const record = mergeSaveSubscriptionKinds('pk-1', RELAY, 44200)
    expect(record.kinds).toEqual([24200, 44200])
  })

  it('merging the same kind twice does not duplicate it', async () => {
    const { mergeSaveSubscriptionKinds } = await import('./save-subscription-store')
    mergeSaveSubscriptionKinds('pk-1', RELAY, 24200)
    const record = mergeSaveSubscriptionKinds('pk-1', RELAY, 24200)
    expect(record.kinds).toEqual([24200])
  })

  it('removes a kind from the owner_p row, keeping the row when other kinds remain', async () => {
    const { mergeSaveSubscriptionKinds, removeSaveSubscriptionKind, listSaveSubscriptions } = await import(
      './save-subscription-store'
    )
    mergeSaveSubscriptionKinds('pk-1', RELAY, 24200)
    mergeSaveSubscriptionKinds('pk-1', RELAY, 44200)
    const record = removeSaveSubscriptionKind('pk-1', RELAY, 24200)
    expect(record?.kinds).toEqual([44200])
    expect(listSaveSubscriptions('pk-1', RELAY)).toEqual([record])
  })

  it('deletes the owner_p row entirely once its last kind is removed', async () => {
    const { mergeSaveSubscriptionKinds, removeSaveSubscriptionKind, listSaveSubscriptions } = await import(
      './save-subscription-store'
    )
    mergeSaveSubscriptionKinds('pk-1', RELAY, 24200)
    const record = removeSaveSubscriptionKind('pk-1', RELAY, 24200)
    expect(record).toBeNull()
    expect(listSaveSubscriptions('pk-1', RELAY)).toEqual([])
  })

  it('removing a kind that was never present is a no-op, not an error', async () => {
    const { mergeSaveSubscriptionKinds, removeSaveSubscriptionKind } = await import('./save-subscription-store')
    mergeSaveSubscriptionKinds('pk-1', RELAY, 24200)
    const record = removeSaveSubscriptionKind('pk-1', RELAY, 999)
    expect(record?.kinds).toEqual([24200])
  })

  it('rejects a non-integer kind for merge and remove (failure path)', async () => {
    const { mergeSaveSubscriptionKinds, removeSaveSubscriptionKind } = await import('./save-subscription-store')
    expect(() => mergeSaveSubscriptionKinds('pk-1', RELAY, 1.5)).toThrow('Missing save subscription kind')
    expect(() => removeSaveSubscriptionKind('pk-1', RELAY, 'nine' as unknown as number)).toThrow(
      'Missing save subscription kind'
    )
  })

  it('scopes list/merge/remove by identity so two identities never see each other\'s rows', async () => {
    const { mergeSaveSubscriptionKinds, listSaveSubscriptions } = await import('./save-subscription-store')
    mergeSaveSubscriptionKinds('pk-1', RELAY, 24200)
    mergeSaveSubscriptionKinds('pk-2', RELAY, 44200)
    expect(listSaveSubscriptions('pk-1', RELAY).map((row) => row.kinds)).toEqual([[24200]])
    expect(listSaveSubscriptions('pk-2', RELAY).map((row) => row.kinds)).toEqual([[44200]])
  })

  it('persists save subscriptions to disk across a fresh module load', async () => {
    const first = await import('./save-subscription-store')
    first.createSaveSubscription('pk-1', RELAY, 'channel_h', 'channel-1', [9])

    vi.resetModules()
    const second = await import('./save-subscription-store')
    expect(second.listSaveSubscriptions('pk-1', RELAY)).toMatchObject([{ scopeValue: 'channel-1', kinds: [9] }])
  })
})
