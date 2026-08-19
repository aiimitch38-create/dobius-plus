import { describe, expect, it } from 'vitest'
import {
  assertValidScopeType,
  assertValidScopeValue,
  normalizeKinds,
  ownerSubscriptionKey,
  sanitizeSaveSubscriptionRow,
  subscriptionKey
} from './save-subscription-record'

describe('save-subscription-record', () => {
  it('accepts each real scope type and rejects anything else', () => {
    for (const type of ['channel_h', 'owner_p', 'referenced_e']) {
      expect(assertValidScopeType(type)).toBe(type)
    }
    expect(() => assertValidScopeType('bogus')).toThrow('Invalid save subscription scope type')
    expect(() => assertValidScopeType(undefined)).toThrow('Invalid save subscription scope type')
  })

  it('rejects a blank scope value', () => {
    expect(assertValidScopeValue('channel-1')).toBe('channel-1')
    expect(() => assertValidScopeValue('')).toThrow('Missing save subscription scope value')
    expect(() => assertValidScopeValue('   ')).toThrow('Missing save subscription scope value')
  })

  it('dedupes and sorts kinds, dropping non-integers', () => {
    expect(normalizeKinds([9, 1, 9, 40002, 1.5, 'nope'])).toEqual([1, 9, 40002])
  })

  it('normalizes a missing kinds field to an empty array, not an error', () => {
    expect(normalizeKinds(undefined)).toEqual([])
  })

  it('builds a stable composite key from the four identifying fields', () => {
    const entry = { identityPubkey: 'pk', relayUrl: 'ws://localhost:3300', scopeType: 'owner_p' as const, scopeValue: 'pk' }
    expect(subscriptionKey(entry)).toBe('pk ws://localhost:3300 owner_p pk')
  })

  it('always targets the caller\'s own owner_p row for merge/remove-kind', () => {
    expect(ownerSubscriptionKey('pk-1', 'ws://localhost:3300')).toEqual({
      identityPubkey: 'pk-1',
      relayUrl: 'ws://localhost:3300',
      scopeType: 'owner_p',
      scopeValue: 'pk-1'
    })
  })

  it('sanitizes a well-formed persisted row', () => {
    const row = sanitizeSaveSubscriptionRow({
      identityPubkey: 'pk-1',
      relayUrl: 'ws://localhost:3300',
      scopeType: 'channel_h',
      scopeValue: 'channel-1',
      kinds: [9, 40002],
      createdAt: 100
    })
    expect(row).toEqual({
      identityPubkey: 'pk-1',
      relayUrl: 'ws://localhost:3300',
      scopeType: 'channel_h',
      scopeValue: 'channel-1',
      kinds: [9, 40002],
      createdAt: 100
    })
  })

  it('drops a corrupted row instead of throwing (failure path)', () => {
    expect(sanitizeSaveSubscriptionRow(null)).toBeNull()
    expect(sanitizeSaveSubscriptionRow({ scopeType: 'not-real' })).toBeNull()
    expect(sanitizeSaveSubscriptionRow({ scopeType: 'owner_p', identityPubkey: '', relayUrl: 'ws://x', scopeValue: 'pk' })).toBeNull()
  })
})
