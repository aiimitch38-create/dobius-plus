/**
 * NIP-02 contact list (kind 3, replaceable per author — see
 * `isReplaceableKind` in relay-types.ts). One event holds every contact as a
 * `p` tag: `["p", pubkey, relayUrl?, petname?]`.
 */

export type ContactEntry = {
  pubkey: string
  relayUrl?: string
  petname?: string
}

export function contactsFromTags(tags: readonly string[][]): ContactEntry[] {
  return tags
    .filter((tag) => tag[0] === 'p' && Boolean(tag[1]))
    .map((tag) => ({
      pubkey: tag[1],
      relayUrl: tag[2] || undefined,
      petname: tag[3] || undefined
    }))
}

export type ContactInput = {
  pubkey: string
  relay_url?: string | null
  petname?: string | null
}

export function contactsToTags(contacts: readonly ContactInput[]): string[][] {
  return contacts.map((contact) => ['p', contact.pubkey.trim().toLowerCase(), contact.relay_url ?? '', contact.petname ?? ''])
}
