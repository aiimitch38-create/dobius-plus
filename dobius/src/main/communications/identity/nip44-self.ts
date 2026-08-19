// The `nip44_encrypt_to_self` / `nip44_decrypt_from_self` Buzz commands.
// "To self" is just the special case of nip44.ts's general peer-to-peer
// primitive where the peer pubkey is the participant's own — see nip44.ts
// for the actual NIP-44 v2 implementation and why it must not be
// duplicated. This file only supplies that one argument.
import { getParticipantPublicIdentity } from '../participant-identity-store'
import { nip44DecryptFromPeer, nip44EncryptToPeer } from './nip44'

/** Encrypts `plaintext` so only the participant's own identity can decrypt it. */
export function nip44EncryptToSelf(plaintext: string): string {
  return nip44EncryptToPeer(getParticipantPublicIdentity().pubkey, plaintext)
}

/** Decrypts a payload produced by `nip44EncryptToSelf`. Throws on a bad MAC or malformed payload. */
export function nip44DecryptFromSelf(payload: string): string {
  return nip44DecryptFromPeer(getParticipantPublicIdentity().pubkey, payload)
}
