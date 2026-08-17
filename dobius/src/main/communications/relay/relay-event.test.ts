import { schnorr } from '@noble/curves/secp256k1'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { computeRelayEventId, parseRelayEvent, verifyRelayEvent } from './relay-event'
import type { RelayEvent } from './relay-types'

/** Pinned clock (seconds). Every test passes `now` explicitly so none depend on the wall clock. */
const NOW = 1_800_000_000

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex')
}

type Keypair = { secretKey: Uint8Array; pubkey: string }

function makeKeypair(): Keypair {
  const secretKey = schnorr.utils.randomSecretKey()
  return { secretKey, pubkey: toHex(schnorr.getPublicKey(secretKey)) }
}

type EventDraft = {
  created_at?: number
  kind?: number
  tags?: string[][]
  content?: string
}

/** Builds a fully valid signed event — the baseline every rejection test mutates. */
function signEvent(keys: Keypair, draft: EventDraft = {}): RelayEvent {
  const unsigned = {
    id: '',
    pubkey: keys.pubkey,
    created_at: draft.created_at ?? NOW - 60,
    kind: draft.kind ?? 1,
    tags: draft.tags ?? [['p', 'a'.repeat(64)]],
    content: draft.content ?? 'hello relay',
    sig: ''
  }
  const id = computeRelayEventId(unsigned)
  return { ...unsigned, id, sig: toHex(schnorr.sign(id, keys.secretKey)) }
}

describe('computeRelayEventId', () => {
  it('hashes the compact NIP-01 serialization with no whitespace', () => {
    const event: RelayEvent = {
      id: '',
      pubkey: 'b'.repeat(64),
      created_at: 1_700_000_000,
      kind: 9,
      tags: [['h', 'room'], ['p', 'c'.repeat(64)]],
      content: 'hi',
      sig: ''
    }
    const expected = createHash('sha256')
      .update(
        `[0,"${'b'.repeat(64)}",1700000000,9,[["h","room"],["p","${'c'.repeat(64)}"]],"hi"]`,
        'utf8'
      )
      .digest('hex')

    expect(computeRelayEventId(event)).toBe(expected)
  })

  it('returns lowercase hex of the right length and ignores id/sig fields', () => {
    const base: RelayEvent = {
      id: 'd'.repeat(64),
      pubkey: 'e'.repeat(64),
      created_at: 10,
      kind: 0,
      tags: [],
      content: '{}',
      sig: 'f'.repeat(128)
    }
    const id = computeRelayEventId(base)

    expect(id).toMatch(/^[0-9a-f]{64}$/)
    expect(computeRelayEventId({ ...base, id: '0'.repeat(64), sig: '1'.repeat(128) })).toBe(id)
  })

  it('changes when any signed field changes', () => {
    const base: RelayEvent = {
      id: '',
      pubkey: 'a'.repeat(64),
      created_at: 100,
      kind: 1,
      tags: [],
      content: 'x',
      sig: ''
    }
    const id = computeRelayEventId(base)

    expect(computeRelayEventId({ ...base, content: 'y' })).not.toBe(id)
    expect(computeRelayEventId({ ...base, created_at: 101 })).not.toBe(id)
    expect(computeRelayEventId({ ...base, kind: 2 })).not.toBe(id)
    expect(computeRelayEventId({ ...base, tags: [['e', 'z']] })).not.toBe(id)
    expect(computeRelayEventId({ ...base, pubkey: 'b'.repeat(64) })).not.toBe(id)
  })
})

describe('verifyRelayEvent', () => {
  it('accepts a real signed round trip', () => {
    const event = signEvent(makeKeypair())

    expect(parseRelayEvent(event)).toEqual(event)
    expect(verifyRelayEvent(event, { now: NOW })).toEqual({ ok: true })
  })

  it('accepts an event with no tags and empty content', () => {
    const event = signEvent(makeKeypair(), { tags: [], content: '', kind: 0 })

    expect(verifyRelayEvent(event, { now: NOW })).toEqual({ ok: true })
  })

  it('accepts a past event when no clock is supplied', () => {
    const event = signEvent(makeKeypair(), { created_at: 1_600_000_000 })

    expect(verifyRelayEvent(event)).toEqual({ ok: true })
  })

  it('rejects tampered content', () => {
    const event = signEvent(makeKeypair())
    const tampered = { ...event, content: 'tampered' }

    const result = verifyRelayEvent(tampered, { now: NOW })
    expect(result.ok).toBe(false)
    expect(result).toEqual({ ok: false, reason: 'invalid: event id does not match its contents' })
  })

  it('rejects tampered tags even when the id is recomputed to match', () => {
    // Recomputing the id defeats the id check, so only the signature catches this.
    const event = signEvent(makeKeypair())
    const forged = { ...event, tags: [['p', 'f'.repeat(64)]] }
    const relabelled = { ...forged, id: computeRelayEventId(forged) }

    expect(verifyRelayEvent(relabelled, { now: NOW })).toEqual({
      ok: false,
      reason: 'invalid: event signature verification failed'
    })
  })

  it('rejects a signature made by a different key', () => {
    const author = makeKeypair()
    const impostor = makeKeypair()
    const event = signEvent(author)
    const wrongSig = { ...event, sig: toHex(schnorr.sign(event.id, impostor.secretKey)) }

    expect(verifyRelayEvent(wrongSig, { now: NOW })).toEqual({
      ok: false,
      reason: 'invalid: event signature verification failed'
    })
  })

  it('rejects an event signed for a different pubkey', () => {
    const event = signEvent(makeKeypair())
    const swapped = { ...event, pubkey: makeKeypair().pubkey }
    const relabelled = { ...swapped, id: computeRelayEventId(swapped) }

    expect(verifyRelayEvent(relabelled, { now: NOW })).toEqual({
      ok: false,
      reason: 'invalid: event signature verification failed'
    })
  })

  it('returns a rejection instead of throwing on a malformed signature', () => {
    const event = signEvent(makeKeypair())
    const malformed = { ...event, sig: 'z'.repeat(128) }

    expect(() => verifyRelayEvent(malformed, { now: NOW })).not.toThrow()
    expect(verifyRelayEvent(malformed, { now: NOW })).toEqual({
      ok: false,
      reason: 'invalid: event signature verification failed'
    })
  })

  it('returns a rejection instead of throwing on a malformed pubkey', () => {
    const event = signEvent(makeKeypair())
    const malformed = { ...event, pubkey: 'zz' }
    const relabelled = { ...malformed, id: computeRelayEventId(malformed) }

    expect(() => verifyRelayEvent(relabelled, { now: NOW })).not.toThrow()
    expect(verifyRelayEvent(relabelled, { now: NOW }).ok).toBe(false)
  })

  it('rejects a created_at far in the future', () => {
    const event = signEvent(makeKeypair(), { created_at: NOW + 86_400 })

    expect(verifyRelayEvent(event, { now: NOW })).toEqual({
      ok: false,
      reason: 'invalid: event created_at is too far in the future'
    })
  })

  it('allows skew up to 900 seconds and rejects one second past it', () => {
    const keys = makeKeypair()

    expect(verifyRelayEvent(signEvent(keys, { created_at: NOW + 900 }), { now: NOW })).toEqual({
      ok: true
    })
    expect(verifyRelayEvent(signEvent(keys, { created_at: NOW + 901 }), { now: NOW }).ok).toBe(false)
  })

  it('does not reject old events', () => {
    const event = signEvent(makeKeypair(), { created_at: 1 })

    expect(verifyRelayEvent(event, { now: NOW })).toEqual({ ok: true })
  })

  it('checks the id before the signature so a tampered event names the id problem', () => {
    const event = signEvent(makeKeypair())
    const tampered = { ...event, content: 'tampered', sig: 'z'.repeat(128) }

    expect(verifyRelayEvent(tampered, { now: NOW })).toEqual({
      ok: false,
      reason: 'invalid: event id does not match its contents'
    })
  })
})

describe('parseRelayEvent', () => {
  const valid: RelayEvent = {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    created_at: 1_700_000_000,
    kind: 1,
    tags: [['p', 'c'.repeat(64)], []],
    content: 'body',
    sig: 'd'.repeat(128)
  }

  it('accepts a well-formed event and strips unknown fields', () => {
    const parsed = parseRelayEvent({ ...valid, extra: 'nope', __proto__marker: 1 })

    expect(parsed).toEqual(valid)
    expect(parsed && Object.keys(parsed).sort()).toEqual([
      'content',
      'created_at',
      'id',
      'kind',
      'pubkey',
      'sig',
      'tags'
    ])
  })

  it('accepts kind 0 and created_at 0', () => {
    expect(parseRelayEvent({ ...valid, kind: 0, created_at: 0 })).not.toBeNull()
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', '{}'],
    ['a number', 7],
    ['an array', [valid]],
    ['an empty object', {}]
  ])('returns null for %s', (_label, input) => {
    expect(parseRelayEvent(input)).toBeNull()
  })

  it.each([
    ['missing id', { ...valid, id: undefined }],
    ['missing pubkey', { ...valid, pubkey: undefined }],
    ['missing sig', { ...valid, sig: undefined }],
    ['missing tags', { ...valid, tags: undefined }],
    ['missing content', { ...valid, content: undefined }],
    ['missing created_at', { ...valid, created_at: undefined }],
    ['missing kind', { ...valid, kind: undefined }],
    ['uppercase id hex', { ...valid, id: 'A'.repeat(64) }],
    ['short id', { ...valid, id: 'a'.repeat(63) }],
    ['long id', { ...valid, id: 'a'.repeat(65) }],
    ['non-hex id', { ...valid, id: 'z'.repeat(64) }],
    ['numeric id', { ...valid, id: 1 }],
    ['uppercase pubkey hex', { ...valid, pubkey: 'B'.repeat(64) }],
    ['short pubkey', { ...valid, pubkey: 'b'.repeat(32) }],
    ['sig of id length', { ...valid, sig: 'd'.repeat(64) }],
    ['uppercase sig hex', { ...valid, sig: 'D'.repeat(128) }],
    ['non-hex sig', { ...valid, sig: 'g'.repeat(128) }],
    ['flat tags', { ...valid, tags: ['p', 'x'] }],
    ['tags with a non-string entry', { ...valid, tags: [['p', 3]] }],
    ['tags with a nested array', { ...valid, tags: [[['p']]] }],
    ['tags as an object', { ...valid, tags: { p: 'x' } }],
    ['tags as a string', { ...valid, tags: 'p' }],
    ['negative created_at', { ...valid, created_at: -1 }],
    ['fractional created_at', { ...valid, created_at: 1_700_000_000.5 }],
    ['NaN created_at', { ...valid, created_at: Number.NaN }],
    ['Infinite created_at', { ...valid, created_at: Number.POSITIVE_INFINITY }],
    ['string created_at', { ...valid, created_at: '1700000000' }],
    ['negative kind', { ...valid, kind: -1 }],
    ['fractional kind', { ...valid, kind: 1.5 }],
    ['string kind', { ...valid, kind: '1' }],
    ['numeric content', { ...valid, content: 42 }],
    ['null content', { ...valid, content: null }],
    ['object content', { ...valid, content: { text: 'x' } }]
  ])('returns null for %s', (_label, input) => {
    expect(parseRelayEvent(input)).toBeNull()
  })

  it('never throws on hostile input', () => {
    const hostile: unknown[] = [
      Object.create(null),
      new Map(),
      Symbol('x'),
      () => valid,
      JSON.parse('{"id":{"toString":1}}')
    ]

    for (const input of hostile) {
      expect(() => parseRelayEvent(input)).not.toThrow()
      expect(parseRelayEvent(input)).toBeNull()
    }
  })
})
