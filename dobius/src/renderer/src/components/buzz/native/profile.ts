// Native port of profile loading + display-name resolution from
// dobiusCommunications.ts (profileFromEvent/loadDobiusUserProfile) and
// src/features/profile/lib/identity.ts + src/shared/lib/pubkey.ts (Buzz).
import { queryRelay, type RelayEventRecord } from './relay-client'

export type RelayProfile = {
  pubkey: string
  displayName: string | null
  avatarUrl: string | null
  nip05Handle: string | null
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function profileFromEvent(pubkey: string, event: RelayEventRecord | undefined): RelayProfile {
  if (!event) {return { pubkey, displayName: null, avatarUrl: null, nip05Handle: null }}
  let content: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(event.content)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      content = parsed as Record<string, unknown>
    }
  } catch {
    // A malformed historical profile must not strand the sidebar.
  }
  return {
    pubkey,
    displayName: nullableText(content.display_name) ?? nullableText(content.name),
    avatarUrl: nullableText(content.picture),
    nip05Handle: nullableText(content.nip05)
  }
}

/** truncatePubkey: first8chars…last4chars, matching Buzz's raw-pubkey display format. */
export function truncatePubkey(pubkey: string): string {
  if (pubkey.length <= 12) {return pubkey}
  return `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`
}

/**
 * resolveUserLabel fallback chain: displayName -> nip05Handle -> fallbackName
 * -> truncated pubkey. Mirrors src/features/profile/lib/identity.ts.
 */
export function resolveUserLabel(
  profile: RelayProfile | undefined,
  pubkey: string,
  fallbackName?: string | null
): string {
  const displayName = profile?.displayName?.trim()
  if (displayName) {return displayName}
  const nip05 = profile?.nip05Handle?.trim()
  if (nip05) {return nip05}
  const fallback = fallbackName?.trim()
  if (fallback) {return fallback}
  return truncatePubkey(pubkey)
}

export async function loadProfilesBatch(pubkeys: string[]): Promise<Map<string, RelayProfile>> {
  const unique = Array.from(new Set(pubkeys))
  const result = new Map<string, RelayProfile>()
  if (unique.length === 0) {return result}

  const events = await queryRelay([{ kinds: [0], authors: unique, limit: unique.length }])
  const latestByAuthor = new Map<string, RelayEventRecord>()
  for (const event of [...events].sort((a, b) => b.created_at - a.created_at)) {
    if (!latestByAuthor.has(event.pubkey)) {latestByAuthor.set(event.pubkey, event)}
  }
  for (const pubkey of unique) {
    result.set(pubkey, profileFromEvent(pubkey, latestByAuthor.get(pubkey)))
  }
  return result
}
