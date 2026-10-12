// Why: the repro scripts talk to a real desktop, which requires handshake v2
// (challenge echo + per-direction frame counters, see
// src/transport/e2ee-sequencing.ts). One copy here instead of three.
import nacl from 'tweetnacl'
import type WebSocket from 'ws'
import {
  acceptE2EEReceivedNonce,
  enableE2EESequencing,
  nextE2EESendNonce
} from '../src/transport/e2ee-sequencing'

export type ScriptE2EESession = {
  encrypt: (plaintext: string) => string
  decrypt: (payload: string) => string | null
  // Resolves with the token to use from now on: a never-used pairing token is
  // single-use and the desktop swaps in a new one (never printed).
  authenticate: (ws: WebSocket, token: string) => Promise<string>
}

function nextMessage(ws: WebSocket, waitingFor: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${waitingFor}`)), 5000)
    ws.once('message', (data) => {
      clearTimeout(timeout)
      resolve(data.toString())
    })
  })
}

export function createScriptE2EESession(serverPublicKeyB64: string): ScriptE2EESession {
  const clientKeys = nacl.box.keyPair()
  const serverPublicKey = new Uint8Array(Buffer.from(serverPublicKeyB64, 'base64'))
  const sharedKey = nacl.box.before(serverPublicKey, clientKeys.secretKey)

  const encrypt = (plaintext: string): string => {
    const nonce = nextE2EESendNonce(sharedKey, nacl.randomBytes(nacl.box.nonceLength))
    const ciphertext = nacl.box.after(new TextEncoder().encode(plaintext), nonce, sharedKey)
    const bundle = new Uint8Array(nonce.length + ciphertext.length)
    bundle.set(nonce)
    bundle.set(ciphertext, nonce.length)
    return Buffer.from(bundle).toString('base64')
  }

  // Why: each script has a global message listener AND per-step listeners, so
  // one frame is decrypted twice; the counter would reject the second read.
  let lastFrame: { payload: string; plaintext: string | null } | null = null
  const decrypt = (payload: string): string | null => {
    if (lastFrame?.payload === payload) {
      return lastFrame.plaintext
    }
    const plaintext = openFrame(payload)
    lastFrame = { payload, plaintext }
    return plaintext
  }

  const openFrame = (payload: string): string | null => {
    const bundle = new Uint8Array(Buffer.from(payload, 'base64'))
    if (bundle.length < nacl.box.nonceLength + nacl.box.overheadLength) {
      return null
    }
    const nonce = bundle.subarray(0, nacl.box.nonceLength)
    const plaintext = nacl.box.open.after(bundle.subarray(nacl.box.nonceLength), nonce, sharedKey)
    return plaintext && acceptE2EEReceivedNonce(sharedKey, nonce)
      ? new TextDecoder().decode(plaintext)
      : null
  }

  const authenticate = async (ws: WebSocket, token: string): Promise<string> => {
    const publicKeyB64 = Buffer.from(clientKeys.publicKey).toString('base64')
    ws.send(JSON.stringify({ type: 'e2ee_hello', publicKeyB64 }))
    const readyRaw = await nextMessage(ws, 'e2ee_ready')
    const ready = JSON.parse(readyRaw) as { type?: string; challenge?: unknown }
    if (ready.type !== 'e2ee_ready' || typeof ready.challenge !== 'string') {
      throw new Error(`Unexpected handshake response (needs handshake v2): ${readyRaw}`)
    }
    enableE2EESequencing(sharedKey, 'client')
    ws.send(
      encrypt(JSON.stringify({ type: 'e2ee_auth', deviceToken: token, challenge: ready.challenge }))
    )
    const authRaw = await nextMessage(ws, 'e2ee_authenticated')
    const plaintext = decrypt(authRaw)
    const auth = plaintext
      ? (JSON.parse(plaintext) as { type?: string; deviceToken?: unknown })
      : null
    if (auth?.type !== 'e2ee_authenticated') {
      throw new Error(`Unexpected auth response: ${plaintext ?? authRaw}`)
    }
    if (typeof auth.deviceToken === 'string') {
      console.warn('[e2ee] pairing token consumed; this session uses the new token')
      return auth.deviceToken
    }
    return token
  }

  return { encrypt, decrypt, authenticate }
}
