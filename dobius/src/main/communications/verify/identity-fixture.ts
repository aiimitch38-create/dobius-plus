/**
 * A real, valid secp256k1 identity + minimal localStorage shim, shared by
 * this directory's integration tests that need `window.localStorage` to
 * hold a signable Dobius identity (dobiusCommunications.ts's
 * `localIdentity()` reads it directly — see that file's
 * DOBIUS_IDENTITY_STORAGE_KEY).
 *
 * Deliberately NOT imported by run-verification.test.ts: importing one
 * .test.ts file's exports from another would also execute its top-level
 * `describe(...)` calls a second time. Small, self-contained fixtures like
 * this one live outside any *.test.ts file so they can be shared safely.
 */
import { schnorr } from '@noble/curves/secp256k1'

export const IDENTITY_STORAGE_KEY = 'dobius-buzz-identity.v1'

export type HarnessIdentity = { privateKeyHex: string; pubkeyHex: string }

/** A real schnorr secp256k1 keypair — signatures against it genuinely verify. */
export async function makeIdentityKeypair(): Promise<HarnessIdentity> {
  const secretKey = schnorr.utils.randomSecretKey()
  const pubkey = schnorr.getPublicKey(secretKey)
  return {
    privateKeyHex: Buffer.from(secretKey).toString('hex'),
    pubkeyHex: Buffer.from(pubkey).toString('hex')
  }
}

export class InMemoryLocalStorage {
  private store = new Map<string, string>()
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
}

export function seedIdentity(storage: InMemoryLocalStorage, identity: HarnessIdentity, username: string): void {
  storage.setItem(
    IDENTITY_STORAGE_KEY,
    JSON.stringify({ privateKey: identity.privateKeyHex, pubkey: identity.pubkeyHex, username })
  )
}
