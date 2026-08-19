/**
 * Record shape and validation for archive "save subscriptions" — local
 * per-identity rules describing which relay events should be kept in the
 * local archive (list_save_subscriptions/create_save_subscription/
 * delete_save_subscription/merge_save_subscription_kinds/
 * remove_save_subscription_kind — vendor call sites in
 * shared/api/tauriArchive.ts). This family owns only the subscription rows
 * themselves; the archiving engine that reads them (archive_events,
 * read_archived_events) is a different feature ("identity-keychain"/
 * "agent-lifecycle" in command-manifest.json) owned by a different agent
 * and out of scope here.
 *
 * Deliberately local, not relay-backed: a subscription is "which events
 * should THIS Dobius instance keep locally", private archival policy, not
 * something other channel participants need to see — unlike the canvas
 * (canvas-document.ts) or notes (social-note.ts) in this same directory,
 * which are genuinely shared and therefore relay events.
 */

export type SaveSubscriptionScopeType = 'channel_h' | 'owner_p' | 'referenced_e'

const SCOPE_TYPES: ReadonlySet<string> = new Set(['channel_h', 'owner_p', 'referenced_e'])

export function isSaveSubscriptionScopeType(value: unknown): value is SaveSubscriptionScopeType {
  return typeof value === 'string' && SCOPE_TYPES.has(value)
}

export function assertValidScopeType(value: unknown): SaveSubscriptionScopeType {
  if (!isSaveSubscriptionScopeType(value)) {
    throw new Error(`Invalid save subscription scope type: ${JSON.stringify(value)}`)
  }
  return value
}

export function assertValidScopeValue(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Missing save subscription scope value')
  }
  return value.trim()
}

export function assertValidIdentityPubkey(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Missing identity pubkey')
  }
  return value.trim()
}

export function assertValidRelayUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Missing relay URL')
  }
  return value.trim()
}

export function normalizeKinds(value: unknown): number[] {
  if (!Array.isArray(value)) {return []}
  const kinds = value.filter((kind): kind is number => typeof kind === 'number' && Number.isInteger(kind))
  return [...new Set(kinds)].sort((a, b) => a - b)
}

export type SaveSubscription = {
  identityPubkey: string
  relayUrl: string
  scopeType: SaveSubscriptionScopeType
  scopeValue: string
  kinds: number[]
  createdAt: number
}

export type SaveSubscriptionKey = Pick<SaveSubscription, 'identityPubkey' | 'relayUrl' | 'scopeType' | 'scopeValue'>

export function subscriptionKey(entry: SaveSubscriptionKey): string {
  return [entry.identityPubkey, entry.relayUrl, entry.scopeType, entry.scopeValue].join(' ')
}

/** Every merge/remove-kind RPC targets exactly this row: the caller's own
 * `owner_p` subscription — see the vendor doc comments on
 * mergeSaveSubscriptionKinds/removeSaveSubscriptionKind for why scopeType
 * and scopeValue are never caller-supplied for these two operations. */
export function ownerSubscriptionKey(identityPubkey: string, relayUrl: string): SaveSubscriptionKey {
  return { identityPubkey, relayUrl, scopeType: 'owner_p', scopeValue: identityPubkey }
}

export function sanitizeSaveSubscriptionRow(raw: unknown): SaveSubscription | null {
  if (!raw || typeof raw !== 'object') {return null}
  const record = raw as Partial<Record<keyof SaveSubscription, unknown>>
  if (!isSaveSubscriptionScopeType(record.scopeType)) {return null}
  const identityPubkey = typeof record.identityPubkey === 'string' ? record.identityPubkey : ''
  const relayUrl = typeof record.relayUrl === 'string' ? record.relayUrl : ''
  const scopeValue = typeof record.scopeValue === 'string' ? record.scopeValue : ''
  if (!identityPubkey || !relayUrl || !scopeValue) {return null}
  return {
    identityPubkey,
    relayUrl,
    scopeType: record.scopeType,
    scopeValue,
    kinds: normalizeKinds(record.kinds),
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now()
  }
}
