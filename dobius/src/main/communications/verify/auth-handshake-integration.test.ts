/**
 * Proves a REAL NIP-42 handshake against the REAL relay (relay-auth.ts +
 * relay-server.ts) over a REAL WebSocket — end to end, vendor-free.
 *
 * Originally built against the vendored client's RelayClient; after the
 * vendor's deletion the same wire contract is now driven by a minimal
 * in-file NIP-42 client (Node's global WebSocket + nostr-tools signing) so
 * the relay-side guarantees stay proven: a validly-signed AUTH event whose
 * challenge tag matches the issued challenge is accepted, and one whose
 * challenge does not match is rejected with the exact relay-side reason,
 * fast (no timeout hang). Everything on the relay side is real and
 * unmodified; the only "simulated" thing is that this test plays the client.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { schnorr } from '@noble/curves/secp256k1'
import { sha256 } from '@noble/hashes/sha256'
import { startVerificationRelay, stopVerificationRelay, type RelayHarness } from './relay-test-harness'
import { RELAY_WS_URL } from './relay-world-wire'

/** One inbound relay frame, parsed. */
type RelayFrame = [command: string, ...rest: unknown[]]

type UnsignedEvent = { kind: number; created_at: number; tags: string[][]; content: string; pubkey: string }
type SignedEvent = UnsignedEvent & { id: string; sig: string }

/** NIP-01 event serialization (the sha256 preimage for the event id). */
function eventSerialize(event: UnsignedEvent): string {
  return JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])
}

/** Signs per NIP-01: id = sha256(serialization), sig = schnorr(id, privkey). */
function signEvent(event: UnsignedEvent, privateKey: Uint8Array): SignedEvent {
  const id = Buffer.from(sha256(eventSerialize(event))).toString('hex')
  const sig = Buffer.from(schnorr.sign(id, privateKey)).toString('hex')
  return { ...event, id, sig }
}

function parseFrame(raw: unknown): RelayFrame | null {
  if (typeof raw !== 'string') {return null}
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as RelayFrame) : null
  } catch {
    return null
  }
}

/**
 * Opens a WebSocket to the harness relay, completes the NIP-42 handshake as
 * a fresh keypair, and resolves once the relay answers OK for the AUTH
 * event it sent. `challengeOverride` replaces the relay-issued challenge tag
 * before signing — the negative test's way of producing a validly-signed
 * event the relay must still refuse.
 */
function runTrackedHandshake(options: { challengeOverride?: string } = {}): Promise<{ pubkey: string; okMessage: string }> {
  const privateKey = schnorr.utils.randomPrivateKey()
  const pubkey = Buffer.from(schnorr.getPublicKey(privateKey)).toString('hex')
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(RELAY_WS_URL)
    let authId = ''
    const fail = (error: unknown): void => {
      try {ws.close()} catch { /* already closing */ }
      reject(error instanceof Error ? error : new Error(String(error)))
    }
    const timer = setTimeout(() => fail(new Error('AUTH handshake timed out after 10s')), 10_000)
    const settle = (result: { pubkey: string; okMessage: string }): void => {
      clearTimeout(timer)
      try {ws.close()} catch { /* already closing */ }
      resolve(result)
    }
    ws.onerror = () => fail(new Error('websocket error during AUTH handshake'))
    ws.onmessage = (messageEvent) => {
      const frame = parseFrame(messageEvent.data)
      if (!frame) {return}
      if (frame[0] === 'AUTH' && typeof frame[1] === 'string') {
        const challenge = options.challengeOverride ?? frame[1]
        const authEvent = signEvent(
          {
            kind: 22242,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
              ['challenge', challenge],
              ['relay', RELAY_WS_URL]
            ],
            content: '',
            pubkey
          },
          privateKey
        )
        authId = authEvent.id
        ws.send(JSON.stringify(['AUTH', authEvent]))
        return
      }
      if (frame[0] === 'OK' && frame[1] === authId) {
        const accepted = frame[2] === true
        const okMessage = typeof frame[3] === 'string' ? frame[3] : ''
        if (accepted) {
          settle({ pubkey, okMessage })
        } else {
          fail(new Error(okMessage))
        }
      }
    }
  })
}

describe('NIP-42 AUTH handshake: minimal real client vs real relay', () => {
  let relay: RelayHarness

  beforeAll(async () => {
    relay = await startVerificationRelay()
    if (!relay.available) {
      // Same safety guard as run-verification.test.ts: refuse to run
      // against what might be a live Dobius+ instance's real relay rather
      // than silently skipping and reporting green.
      throw new Error(`cannot run the AUTH handshake integration test: ${relay.reason}`)
    }
  })

  afterAll(async () => {
    await stopVerificationRelay(relay)
  })

  it('completes the real handshake: relay accepts a correctly-signed AUTH event', async () => {
    const result = await runTrackedHandshake()
    expect(result.pubkey).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects a wrong challenge: relay replies OK=false with the exact mismatch reason (no hang)', async () => {
    const startedAt = Date.now()
    // Asserting the EXACT message relay-auth.ts's applyAuthFrame returns for
    // this specific failure — not just "some auth error" — is what proves
    // this is really the challenge-mismatch code path on the relay, not a
    // generic catch-all.
    await expect(
      runTrackedHandshake({ challengeOverride: 'deliberately-wrong-challenge-for-negative-test' })
    ).rejects.toThrow(/challenge does not match/i)

    // A real OK=false response resolves immediately; only a dropped/ignored
    // reply would fall through to the 10s timeout.
    expect(Date.now() - startedAt).toBeLessThan(5_000)
  })
})
