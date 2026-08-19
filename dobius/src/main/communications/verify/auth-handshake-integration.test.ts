/**
 * Proves the REAL vendored client (RelayClient in relayClientSession.ts)
 * completes the REAL NIP-42 handshake against the REAL relay
 * (relay-auth.ts + relay-server.ts) over a REAL WebSocket — end to end.
 *
 * Built because the two halves of this handshake, written by two different
 * agents, had never been executed against each other: the relay's own tests
 * drive it with a hand-built event, and the client's transport tests
 * explicitly skip the auth leg. If the two disagreed on any wire detail —
 * tag name, challenge echo, OK matching — live chat would silently fail
 * while every existing suite stayed green. See MISMATCHES_FOUND in this
 * task's report for what was found.
 *
 * Real vs. simulated, stated plainly:
 *   REAL: relay-auth.ts, relay-server.ts, relayClientSession.ts's actual
 *   `preconnect()` -> `connect()` -> `handleAuthChallenge()` ->
 *   `handleWsMessage()` -> `handleOk()` path, the real WebSocket transport
 *   (Node's native global WebSocket talking to a real `ws`-backed relay
 *   server), real nostr signing/verification (dobiusCommunications.ts's
 *   `create_auth_event` case, unmodified), a real generated secp256k1
 *   identity.
 *   SIMULATED (one thing, in the negative test only): the *content* of the
 *   inbound `["AUTH", challenge]` frame the client receives is swapped for
 *   a wrong value in transit — see the `vi.mock` below for exactly what and
 *   why. Everything downstream of that swap (signing, sending, relay
 *   validation, client error handling) is real and unmodified.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createRuntimeBridge } from './runtime-bridge-harness'
import { startVerificationRelay, stopVerificationRelay, type RelayHarness } from './relay-test-harness'
import { InMemoryLocalStorage, makeIdentityKeypair, seedIdentity } from './identity-fixture'
import type * as RelayWebSocketClose from '@/shared/api/relayWebSocketClose'

/**
 * Fault-injection switch for the negative test. `vi.hoisted` so the value
 * this flag holds is shared between this file's top-level `vi.mock` factory
 * (which Vitest hoists above all imports) and the `it()` blocks below that
 * flip it.
 */
const authFault = vi.hoisted(() => ({ corruptNextChallenge: false }))

/**
 * Intercepts exactly one thing: the client's RECEIPT of the relay's
 * unsolicited `["AUTH", <challenge>]` frame, and only when
 * `authFault.corruptNextChallenge` is set. Every other frame, and both
 * `openWebSocket`/`sendOnWebSocket`'s real implementations, pass through via
 * `importOriginal()` untouched.
 *
 * Why intercept the RECEIVE side and not tamper with the outgoing signed
 * AUTH reply directly: the client always signs an event whose `challenge`
 * tag matches whatever challenge string it believes it was issued. Tampering
 * the outgoing frame after signing would invalidate the signature and the
 * relay would reject it for a bad signature — a real rejection, but the
 * WRONG one to prove ("bad signature" instead of "wrong challenge"). Feeding
 * the client a wrong challenge to sign in the first place means it produces
 * a fully validly-signed AUTH event whose `challenge` tag genuinely doesn't
 * match what the relay actually issued and is holding in its per-connection
 * state — which is exactly the check relay-auth.ts's `applyAuthFrame` exists
 * to enforce, and exactly what a client with a real handshake bug (or an
 * attacker) would look like on the wire.
 */
vi.mock('@/shared/api/relayWebSocketClose', async (importOriginal) => {
  const actual = await importOriginal<typeof RelayWebSocketClose>()
  return {
    ...actual,
    openWebSocket: (url: string, onMessage: (message: unknown) => void) => {
      const wrapped = (message: unknown): void => {
        if (authFault.corruptNextChallenge && typeof message === 'string') {
          try {
            const frame: unknown = JSON.parse(message)
            if (Array.isArray(frame) && frame[0] === 'AUTH' && typeof frame[1] === 'string') {
              authFault.corruptNextChallenge = false
              onMessage(JSON.stringify(['AUTH', 'deliberately-wrong-challenge-for-negative-test']))
              return
            }
          } catch {
            // Not JSON, or not the shape we're looking for — deliver as-is.
          }
        }
        onMessage(message)
      }
      return actual.openWebSocket(url, wrapped)
    }
  }
})

// Imported after the mock above (Vitest hoists vi.mock ahead of this file's
// own static imports, same mechanism runtime-bridge-harness.ts relies on for
// vi.mock('electron', ...) — see that file's doc comment).
import { RelayClient } from '@/shared/api/relayClientSession'

describe('NIP-42 AUTH handshake: real client vs real relay', () => {
  let relay: RelayHarness

  beforeAll(async () => {
    relay = await startVerificationRelay()
    if (!relay.available) {
      // Same safety guard as run-verification.test.ts: refuse to run
      // against what might be a live Dobius+ instance's real relay rather
      // than silently skipping and reporting green.
      throw new Error(`cannot run the AUTH handshake integration test: ${relay.reason}`)
    }

    const identity = await makeIdentityKeypair()
    const localStorage = new InMemoryLocalStorage()
    seedIdentity(localStorage, identity, 'AUTH Handshake Test')

    ;(globalThis as unknown as { window: Record<string, unknown> }).window = {
      localStorage,
      dobiusCommunications: createRuntimeBridge(),
      // relayClientSession.ts calls window.setTimeout/clearTimeout
      // explicitly throughout (auth timeout, stability timer, event batch
      // flush, etc.), and RelayStallWatchdog (started once the handshake
      // succeeds) calls window.setInterval/clearInterval — all four must
      // exist on the fake window, not just setTimeout as
      // run-verification.test.ts's window shim provides (that harness never
      // reaches "connected", so it never needed the other three).
      setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
      clearTimeout: (...args: Parameters<typeof clearTimeout>) => clearTimeout(...args),
      setInterval: (...args: Parameters<typeof setInterval>) => setInterval(...args),
      clearInterval: (...args: Parameters<typeof clearInterval>) => clearInterval(...args)
    }
  })

  afterAll(async () => {
    await stopVerificationRelay(relay)
  })

  afterEach(() => {
    authFault.corruptNextChallenge = false
  })

  it('completes the real handshake: preconnect() resolves and the client reaches "connected"', async () => {
    const client = new RelayClient()
    expect(client.getConnectionState()).toBe('idle')

    await client.preconnect()

    expect(client.getConnectionState()).toBe('connected')
    client.disconnect()
  })

  it('rejects a wrong challenge: relay replies OK=false, the real client surfaces the real rejection reason (no 25s hang)', async () => {
    authFault.corruptNextChallenge = true
    const client = new RelayClient()
    const startedAt = Date.now()

    // Asserting the EXACT message relay-auth.ts's applyAuthFrame returns for
    // this specific failure ('invalid: AUTH event challenge does not
    // match') — not just "some auth error" — is what proves this is really
    // the challenge-mismatch code path on both sides, not a generic
    // catch-all. relayClientSession.ts's handleOk() passes the relay's OK
    // message straight through as the Error it rejects with.
    await expect(client.preconnect()).rejects.toThrow(/challenge does not match/i)

    const elapsedMs = Date.now() - startedAt
    // AUTH_TIMEOUT_MS in relayClientSession.ts is 25_000. A real OK=false
    // response resolves the pending auth promise immediately; only a
    // dropped/ignored reply would fall through to that timeout.
    expect(elapsedMs).toBeLessThan(5_000)

    expect(client.getConnectionState()).toBe('disconnected')
  })
})
