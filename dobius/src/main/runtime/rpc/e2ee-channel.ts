// Why: the E2EE channel sits between the WebSocket transport and the RPC handler.
// It owns the handshake state machine and transparent encrypt/decrypt so the RPC
// handler only sees plaintext JSON, identical to the Unix socket path.
import { randomBytes } from 'node:crypto'
import type { WebSocket } from 'ws'
import { E2EE_CLIENT_UPDATE_REQUIRED, E2EE_HANDSHAKE_VERSION } from '../../../shared/e2ee-handshake'
import {
  enableE2EESequencingFromFirstFrame,
  isE2EESequenceViolated
} from '../../../shared/e2ee-sequencing'
import { constantTimeEqual } from '../../lib/constant-time-equal'
import { deriveSharedKey, encrypt, decrypt, encryptBytes, decryptBytes } from './e2ee-crypto'

type ChannelState = 'awaiting_hello' | 'awaiting_auth' | 'ready'

const HANDSHAKE_TIMEOUT_MS = 10_000
const MAX_CONSECUTIVE_DECRYPT_FAILURES = 5
const MAX_BINARY_BUFFERED_AMOUNT = 8 * 1024 * 1024
const HANDSHAKE_CHALLENGE_BYTES = 32
const AUTH_NONCE_BYTES = 24
// Why: distinct from 4001 so logs tell an outdated client from a bad token.
const CLOSE_CLIENT_UPDATE_REQUIRED = 4010
const CLOSE_OUT_OF_SEQUENCE = 4004

type E2EEHello = {
  type: 'e2ee_hello'
  publicKeyB64: string
}

type E2EEAuth = {
  type: 'e2ee_auth'
  deviceToken: string
  challenge?: unknown
}

export type E2EEChannelOptions = {
  serverSecretKey: Uint8Array
  validateToken: (token: string) => boolean
  // Why: a pairing QR token is single-use. Called right after validateToken in
  // the same tick, it returns the replacement token when this login consumed a
  // pairing offer (sent to the client inside the encrypted channel), or null.
  claimToken?: (token: string) => string | null
  onReady: (channel: E2EEChannel) => void
  onError: (code: number, reason: string) => void
}

export class E2EEChannel {
  private state: ChannelState = 'awaiting_hello'
  private sharedKey: Uint8Array | null = null
  // Why: fresh per connection; the auth frame must echo it (handshake v2).
  private challenge: string | null = null
  private consecutiveFailures = 0
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null
  private readonly ws: WebSocket
  private readonly serverSecretKey: Uint8Array
  private readonly validateToken: (token: string) => boolean
  private readonly claimToken: ((token: string) => string | null) | undefined
  private readonly onReady: (channel: E2EEChannel) => void
  private readonly onError: (code: number, reason: string) => void
  // Why: the RPC handler is set after the channel is ready, so the channel
  // can forward decrypted messages. Kept as a callback rather than constructor
  // param because the handler needs the encrypt function for replies.
  private messageHandler:
    | ((
        plaintext: string,
        encryptedReply: (response: string) => void,
        encryptedBinaryReply: (response: Uint8Array<ArrayBufferLike>) => boolean | void
      ) => void)
    | null = null
  private binaryMessageHandler: ((plaintext: Uint8Array<ArrayBufferLike>) => void) | null = null

  deviceToken: string | null = null

  constructor(ws: WebSocket, options: E2EEChannelOptions) {
    this.ws = ws
    this.serverSecretKey = options.serverSecretKey
    this.validateToken = options.validateToken
    this.claimToken = options.claimToken
    this.onReady = options.onReady
    this.onError = options.onError

    this.handshakeTimer = setTimeout(() => {
      this.onError(4002, 'E2EE handshake timeout')
    }, HANDSHAKE_TIMEOUT_MS)
  }

  onMessage(
    handler: (
      plaintext: string,
      encryptedReply: (response: string) => void,
      encryptedBinaryReply: (response: Uint8Array<ArrayBufferLike>) => boolean | void
    ) => void
  ): void {
    this.messageHandler = handler
  }

  onBinaryMessage(handler: (plaintext: Uint8Array<ArrayBufferLike>) => void): void {
    this.binaryMessageHandler = handler
  }

  handleRawMessage(raw: string | Uint8Array<ArrayBufferLike>): void {
    if (this.state === 'awaiting_hello') {
      if (typeof raw !== 'string') {
        this.onError(4001, 'Invalid handshake message')
        return
      }
      this.handleHello(raw)
      return
    }

    if (!this.sharedKey) {
      return
    }

    if (typeof raw !== 'string') {
      const plaintextBytes = decryptBytes(raw, this.sharedKey)
      if (plaintextBytes === null) {
        this.handleDecryptFailure(this.sharedKey)
        return
      }
      this.consecutiveFailures = 0
      if (this.state !== 'ready') {
        this.onError(4001, 'Invalid binary message before authentication')
        return
      }
      this.binaryMessageHandler?.(plaintextBytes)
      return
    }

    const plaintext = decrypt(raw, this.sharedKey)
    if (plaintext === null) {
      this.handleDecryptFailure(this.sharedKey)
      return
    }

    this.consecutiveFailures = 0
    if (this.state === 'awaiting_auth') {
      this.handleAuth(plaintext, Buffer.from(raw, 'base64').subarray(0, AUTH_NONCE_BYTES))
      return
    }

    // Why: streaming RPC handlers (e.g. terminal.subscribe) retain this
    // closure and may fire emits long after the inbound message handled
    // here. If destroy() runs in between (mobile disconnect, handshake
    // failure) sharedKey becomes null and tweetnacl throws "unexpected
    // type, use Uint8Array" from inside nacl.box.after. Guard both the
    // socket state AND the key so late emits become silent no-ops.
    const encryptedReply = (response: string) => {
      if (!this.sharedKey || this.ws.readyState !== this.ws.OPEN) {
        return
      }
      this.ws.send(encrypt(response, this.sharedKey))
    }
    const encryptedBinaryReply = (response: Uint8Array<ArrayBufferLike>): boolean => {
      if (!this.sharedKey || this.ws.readyState !== this.ws.OPEN) {
        return false
      }
      if (this.ws.bufferedAmount > MAX_BINARY_BUFFERED_AMOUNT) {
        return false
      }
      this.ws.send(Buffer.from(encryptBytes(response, this.sharedKey)), { binary: true })
      return true
    }
    this.messageHandler?.(plaintext, encryptedReply, encryptedBinaryReply)
  }

  // Why: an authentic frame out of sequence means a frame was replayed,
  // reordered or deleted on the path; the session cannot be trusted any more.
  private handleDecryptFailure(sharedKey: Uint8Array): void {
    if (isE2EESequenceViolated(sharedKey)) {
      this.onError(CLOSE_OUT_OF_SEQUENCE, 'Out-of-sequence frame')
      return
    }
    this.trackDecryptFailure()
  }

  private trackDecryptFailure(): void {
    this.consecutiveFailures++
    if (this.consecutiveFailures >= MAX_CONSECUTIVE_DECRYPT_FAILURES) {
      this.onError(4003, 'Too many decryption failures')
    }
  }

  private handleHello(raw: string): void {
    let hello: E2EEHello
    try {
      hello = JSON.parse(raw) as E2EEHello
    } catch {
      this.onError(4001, 'Invalid handshake message')
      return
    }

    if (hello.type !== 'e2ee_hello' || !hello.publicKeyB64) {
      this.onError(4001, 'Invalid e2ee_hello')
      return
    }

    // Why: derive the shared key from our secret + client's public key.
    // Both sides compute the same shared secret via ECDH.
    const clientPublicKey = Uint8Array.from(Buffer.from(hello.publicKeyB64, 'base64'))
    if (clientPublicKey.length !== 32) {
      this.onError(4001, 'Invalid public key')
      return
    }

    this.sharedKey = deriveSharedKey(this.serverSecretKey, clientPublicKey)
    this.challenge = randomBytes(HANDSHAKE_CHALLENGE_BYTES).toString('base64')
    this.state = 'awaiting_auth'

    // Why: send e2ee_ready as plaintext — the client needs it to know the
    // key exchange succeeded before it can send encrypted authentication.
    // The challenge may be public: a replayer still cannot encrypt it
    // without the client's ephemeral secret key.
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'e2ee_ready',
          version: E2EE_HANDSHAKE_VERSION,
          challenge: this.challenge
        })
      )
    }
  }

  private handleAuth(plaintext: string, authNonce: Uint8Array): void {
    let auth: E2EEAuth
    try {
      auth = JSON.parse(plaintext) as E2EEAuth
    } catch {
      this.sendEncryptedControl({ type: 'e2ee_error', error: { code: 'bad_auth' } })
      this.onError(4001, 'Invalid e2ee_auth')
      return
    }

    if (auth.type !== 'e2ee_auth' || !auth.deviceToken) {
      this.sendEncryptedControl({ type: 'e2ee_error', error: { code: 'bad_auth' } })
      this.onError(4001, 'Invalid e2ee_auth')
      return
    }
    if (auth.challenge === undefined) {
      // Why: a pre-v2 client cannot prove freshness, so accepting it would
      // reopen the replay hole. Reject with a reason it can show and log.
      this.sendEncryptedControl({
        type: 'e2ee_error',
        error: {
          code: E2EE_CLIENT_UPDATE_REQUIRED,
          message: 'This Dobius app is too old for this desktop. Update the app, then reconnect.'
        }
      })
      this.onError(CLOSE_CLIENT_UPDATE_REQUIRED, 'Client update required')
      return
    }
    if (!this.challenge || !constantTimeEqual(auth.challenge, this.challenge)) {
      this.sendEncryptedControl({ type: 'e2ee_error', error: { code: 'bad_auth' } })
      this.onError(4001, 'Stale e2ee_auth')
      return
    }
    if (
      !this.sharedKey ||
      !enableE2EESequencingFromFirstFrame(this.sharedKey, 'server', authNonce)
    ) {
      this.sendEncryptedControl({ type: 'e2ee_error', error: { code: 'bad_auth' } })
      this.onError(4001, 'Unsequenced e2ee_auth')
      return
    }
    if (!this.validateToken(auth.deviceToken)) {
      this.sendEncryptedControl({ type: 'e2ee_error', error: { code: 'unauthorized' } })
      this.onError(4001, 'Unauthorized')
      return
    }
    let rotatedToken: string | null
    try {
      rotatedToken = this.claimToken?.(auth.deviceToken) ?? null
    } catch (error) {
      // Why: if the single-use swap cannot be saved, fail the login rather
      // than leave the QR token valid or hand out a token that is not on disk.
      console.error('[e2ee] could not consume pairing offer:', error)
      this.sendEncryptedControl({ type: 'e2ee_error', error: { code: 'unauthorized' } })
      this.onError(4001, 'Unauthorized')
      return
    }

    this.deviceToken = rotatedToken ?? auth.deviceToken
    this.challenge = null
    this.state = 'ready'

    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer)
      this.handshakeTimer = null
    }

    this.sendEncryptedControl(
      rotatedToken
        ? { type: 'e2ee_authenticated', deviceToken: rotatedToken }
        : { type: 'e2ee_authenticated' }
    )
    this.onReady(this)
  }

  private sendEncryptedControl(message: unknown): void {
    if (this.ws.readyState === this.ws.OPEN && this.sharedKey) {
      this.ws.send(encrypt(JSON.stringify(message), this.sharedKey))
    }
  }

  destroy(): void {
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer)
      this.handshakeTimer = null
    }
    this.sharedKey = null
    this.challenge = null
    this.messageHandler = null
    this.binaryMessageHandler = null
  }
}
