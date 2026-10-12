// Why: handshake v2 stops replay across connections, but inside one session
// every frame is sealed with the same key, so a captured frame could be
// re-injected or two frames swapped. v2 therefore carries a per-direction
// counter in the 24-byte NaCl nonce: [direction][uint64 counter][15 random].
// The nonce is authenticated by XSalsa20-Poly1305, so it cannot be edited
// without the key; the random tail keeps nonces unique even if a replayed
// hello makes the server derive a key it used before.
//
// State is kept per shared-key object (WeakMap) so the existing
// encrypt/decrypt(…, sharedKey) call sites need no signature change. Each
// connection derives its own key object, so counters never leak between
// sockets. The Expo app mirrors this in mobile/src/transport/e2ee-sequencing.ts.
export type E2EERole = 'client' | 'server'

const CLIENT_TO_SERVER = 0x01
const SERVER_TO_CLIENT = 0x02
export const E2EE_NONCE_LENGTH = 24

type SequenceState = {
  sendDirection: number
  receiveDirection: number
  sent: number
  received: number
  violated: boolean
}

const sequenceStates = new WeakMap<Uint8Array, SequenceState>()

export function enableE2EESequencing(sharedKey: Uint8Array, role: E2EERole): void {
  sequenceStates.set(sharedKey, {
    sendDirection: role === 'client' ? CLIENT_TO_SERVER : SERVER_TO_CLIENT,
    receiveDirection: role === 'client' ? SERVER_TO_CLIENT : CLIENT_TO_SERVER,
    sent: 0,
    received: 0,
    violated: false
  })
}

// Why: the server decrypts the v2 auth frame before it knows the peer speaks
// v2 (a v1 client must still receive its update-required error in the v1
// format). Once the challenge checks out it switches sequencing on, starting
// the receive counter at that auth frame. False if the frame was not sealed
// with a client-to-server sequenced nonce.
export function enableE2EESequencingFromFirstFrame(
  sharedKey: Uint8Array,
  role: E2EERole,
  firstReceivedNonce: Uint8Array
): boolean {
  enableE2EESequencing(sharedKey, role)
  if (acceptE2EEReceivedNonce(sharedKey, firstReceivedNonce)) {
    return true
  }
  sequenceStates.delete(sharedKey)
  return false
}

export function isE2EESequenced(sharedKey: Uint8Array): boolean {
  return sequenceStates.has(sharedKey)
}

// Returns the nonce to seal with: the random nonce unchanged for an
// unsequenced (v1-peer) key, otherwise direction + next counter + random tail.
export function nextE2EESendNonce(sharedKey: Uint8Array, randomNonce: Uint8Array): Uint8Array {
  const state = sequenceStates.get(sharedKey)
  if (!state) {
    return randomNonce
  }
  state.sent += 1
  const nonce = new Uint8Array(E2EE_NONCE_LENGTH)
  nonce.set(randomNonce.subarray(9, E2EE_NONCE_LENGTH), 9)
  nonce[0] = state.sendDirection
  writeCounter(nonce, state.sent)
  return nonce
}

// Call only AFTER the ciphertext authenticated, so forged frames can never
// advance the counter. WebSocket over TCP is in-order and lossless, so the
// next frame must carry exactly the next counter: a replayed, reordered,
// reflected (wrong direction byte) or deleted-in-transit frame is refused and
// the key is marked violated so the caller drops the connection.
export function acceptE2EEReceivedNonce(sharedKey: Uint8Array, nonce: Uint8Array): boolean {
  const state = sequenceStates.get(sharedKey)
  if (!state) {
    return true
  }
  if (
    nonce.length !== E2EE_NONCE_LENGTH ||
    nonce[0] !== state.receiveDirection ||
    readCounter(nonce) !== state.received + 1
  ) {
    state.violated = true
    return false
  }
  state.received += 1
  return true
}

// Why: a null from decrypt is either a frame that failed authentication
// (noise, a wrong key) or an authentic frame out of sequence. Only the second
// proves someone is tampering with the stream, and it is always fatal.
export function isE2EESequenceViolated(sharedKey: Uint8Array): boolean {
  return sequenceStates.get(sharedKey)?.violated === true
}

function writeCounter(nonce: Uint8Array, counter: number): void {
  const view = new DataView(nonce.buffer, nonce.byteOffset, nonce.byteLength)
  view.setUint32(1, Math.floor(counter / 0x1_0000_0000))
  view.setUint32(5, counter >>> 0)
}

function readCounter(nonce: Uint8Array): number {
  const view = new DataView(nonce.buffer, nonce.byteOffset, nonce.byteLength)
  return view.getUint32(1) * 0x1_0000_0000 + view.getUint32(5)
}
