import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../identity/nip44', () => ({
  nip44DecryptFromPeer: vi.fn(),
  nip44EncryptToPeer: vi.fn()
}))
vi.mock('../participant-identity-store', () => ({
  signParticipantEvent: vi.fn()
}))

import { nip44DecryptFromPeer, nip44EncryptToPeer } from '../identity/nip44'
import { signParticipantEvent } from '../participant-identity-store'
import { buildObserverControlEvent, decryptObserverEvent } from './observer-event-crypto'

const AGENT_PUBKEY = 'a'.repeat(64)

describe('observer event crypto (delegates to the identity slice, no second NIP-44)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('decrypts using the event pubkey as the peer, lowercased', () => {
    vi.mocked(nip44DecryptFromPeer).mockReturnValue('{"type":"verify_probe"}')
    const eventJson = JSON.stringify({ pubkey: AGENT_PUBKEY.toUpperCase(), content: 'ciphertext' })

    const result = decryptObserverEvent(eventJson)

    expect(nip44DecryptFromPeer).toHaveBeenCalledWith(AGENT_PUBKEY, 'ciphertext')
    expect(result).toEqual({ type: 'verify_probe' })
  })

  it('rejects malformed event JSON without calling into the crypto layer', () => {
    expect(() => decryptObserverEvent('not json')).toThrow(/not valid JSON/)
    expect(() => decryptObserverEvent('{"pubkey":"x"}')).toThrow(/missing pubkey\/content/)
    expect(nip44DecryptFromPeer).not.toHaveBeenCalled()
  })

  it('builds a kind:24200 event addressed to the agent, encrypted via the peer primitive', () => {
    vi.mocked(nip44EncryptToPeer).mockReturnValue('encrypted-payload')
    vi.mocked(signParticipantEvent).mockReturnValue({
      id: 'event-id',
      pubkey: 'my-pubkey',
      created_at: 1000,
      kind: 24200,
      tags: [
        ['p', AGENT_PUBKEY],
        ['frame', 'control']
      ],
      content: 'encrypted-payload',
      sig: 'signature'
    })

    const result = buildObserverControlEvent(AGENT_PUBKEY.toUpperCase(), { type: 'cancel_turn' })

    expect(nip44EncryptToPeer).toHaveBeenCalledWith(AGENT_PUBKEY, JSON.stringify({ type: 'cancel_turn' }))
    expect(signParticipantEvent).toHaveBeenCalledWith({
      kind: 24200,
      content: 'encrypted-payload',
      tags: [
        ['p', AGENT_PUBKEY],
        ['frame', 'control']
      ]
    })
    expect(JSON.parse(result)).toMatchObject({ kind: 24200, sig: 'signature' })
  })

  it('round-trips through both functions using real closures (not mocked) between build and decrypt shape', () => {
    // Why: proves buildObserverControlEvent's output is exactly the shape
    // decryptObserverEvent's parser expects (pubkey/content present), even
    // though the crypto itself is mocked in this file — the real crypto
    // round-trip is covered by nip44.ts's own test suite (identity-owned;
    // not duplicated here per that file's "one NIP-44 implementation" rule).
    vi.mocked(nip44EncryptToPeer).mockReturnValue('cipher')
    vi.mocked(signParticipantEvent).mockReturnValue({
      id: 'id',
      pubkey: 'sender-pubkey',
      created_at: 1000,
      kind: 24200,
      tags: [['p', AGENT_PUBKEY]],
      content: 'cipher',
      sig: 'sig'
    })
    const built = buildObserverControlEvent(AGENT_PUBKEY, { a: 1 })

    vi.mocked(nip44DecryptFromPeer).mockReturnValue('{"a":1}')
    const decrypted = decryptObserverEvent(built)

    expect(nip44DecryptFromPeer).toHaveBeenCalledWith('sender-pubkey', 'cipher')
    expect(decrypted).toEqual({ a: 1 })
  })
})
