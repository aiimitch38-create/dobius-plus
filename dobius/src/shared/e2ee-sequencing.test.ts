import { describe, expect, it } from 'vitest'
import { decrypt, deriveSharedKey, encrypt, generateKeyPair } from './e2ee-crypto'
import { enableE2EESequencing, isE2EESequenceViolated } from './e2ee-sequencing'

// Why: F5 — inside one v2 session a captured frame must not be accepted
// twice, out of order, or bounced back at its sender.
function pair() {
  const server = generateKeyPair()
  const client = generateKeyPair()
  const clientKey = deriveSharedKey(client.secretKey, server.publicKey)
  const serverKey = deriveSharedKey(server.secretKey, client.publicKey)
  enableE2EESequencing(clientKey, 'client')
  enableE2EESequencing(serverKey, 'server')
  return { clientKey, serverKey }
}

describe('E2EE frame sequencing (F5)', () => {
  it('delivers frames in order', () => {
    const { clientKey, serverKey } = pair()
    expect(decrypt(encrypt('a', clientKey), serverKey)).toBe('a')
    expect(decrypt(encrypt('b', clientKey), serverKey)).toBe('b')
    expect(decrypt(encrypt('reply', serverKey), clientKey)).toBe('reply')
  })

  it('rejects a replayed frame and flags the stream', () => {
    const { clientKey, serverKey } = pair()
    const frame = encrypt('terminal input', clientKey)
    expect(decrypt(frame, serverKey)).toBe('terminal input')
    expect(isE2EESequenceViolated(serverKey)).toBe(false)
    expect(decrypt(frame, serverKey)).toBeNull()
    expect(isE2EESequenceViolated(serverKey)).toBe(true)
  })

  it('rejects reordered frames', () => {
    const { clientKey, serverKey } = pair()
    encrypt('1', clientKey)
    const second = encrypt('2', clientKey)
    expect(decrypt(second, serverKey)).toBeNull()
    expect(isE2EESequenceViolated(serverKey)).toBe(true)
  })

  it('detects a frame deleted in transit (round 2 F1)', () => {
    const { clientKey, serverKey } = pair()
    const first = encrypt('1', clientKey)
    encrypt('deleted on the path', clientKey)
    const third = encrypt('3', clientKey)
    expect(decrypt(first, serverKey)).toBe('1')
    expect(decrypt(third, serverKey)).toBeNull()
    expect(isE2EESequenceViolated(serverKey)).toBe(true)
  })

  it('does not flag a frame that merely fails authentication', () => {
    const { serverKey } = pair()
    const strangerKey = deriveSharedKey(generateKeyPair().secretKey, generateKeyPair().publicKey)
    expect(decrypt(encrypt('noise', strangerKey), serverKey)).toBeNull()
    expect(isE2EESequenceViolated(serverKey)).toBe(false)
  })

  it('rejects a frame reflected back at its sender', () => {
    const { clientKey, serverKey } = pair()
    const fromServer = encrypt('reply', serverKey)
    expect(decrypt(fromServer, serverKey)).toBeNull()
    expect(decrypt(fromServer, clientKey)).toBe('reply')
  })

  it('does not let a forged frame advance the counter', () => {
    const { clientKey, serverKey } = pair()
    const good = encrypt('ok', clientKey)
    const forged = Buffer.from(encrypt('x', clientKey), 'base64')
    forged[forged.length - 1] ^= 0xff
    expect(decrypt(forged.toString('base64'), serverKey)).toBeNull()
    expect(decrypt(good, serverKey)).toBe('ok')
  })
})
