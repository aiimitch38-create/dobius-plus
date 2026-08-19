import { schnorr } from '@noble/curves/secp256k1'
import { describe, expect, it } from 'vitest'
import { decodeNpub, decodeNsec, encodeNpub, encodeNsec, looksLikeNsec } from './nip19-codec'

describe('nip19-codec', () => {
  it('round-trips a real secp256k1 keypair through nsec/npub encoding', () => {
    const privateKeyBytes = schnorr.utils.randomPrivateKey()
    const privateKeyHex = Buffer.from(privateKeyBytes).toString('hex')
    const pubkeyHex = Buffer.from(schnorr.getPublicKey(privateKeyBytes)).toString('hex')

    const nsec = encodeNsec(privateKeyHex)
    const npub = encodeNpub(pubkeyHex)
    expect(nsec.startsWith('nsec1')).toBe(true)
    expect(npub.startsWith('npub1')).toBe(true)
    expect(decodeNsec(nsec)).toBe(privateKeyHex)
    expect(decodeNpub(npub)).toBe(pubkeyHex)
  })

  it('rejects decoding an npub as an nsec and vice versa', () => {
    const privateKeyHex = Buffer.from(schnorr.utils.randomPrivateKey()).toString('hex')
    const npub = encodeNpub(privateKeyHex)
    expect(() => decodeNsec(npub)).toThrow(/not a valid NIP-19 private key/)
  })

  it('looksLikeNsec distinguishes nsec strings from ncryptsec/npub without decoding', () => {
    const nsec = encodeNsec(Buffer.from(schnorr.utils.randomPrivateKey()).toString('hex'))
    expect(looksLikeNsec(nsec)).toBe(true)
    expect(looksLikeNsec('ncryptsec1qqqqqqq')).toBe(false)
    expect(looksLikeNsec('npub1qqqqqqq')).toBe(false)
  })
})
