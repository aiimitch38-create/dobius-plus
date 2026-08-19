/**
 * Relay-wide membership (owner/admin/member of the relay itself, not a single
 * channel — that's kind 39002, handled elsewhere).
 *
 * Follows the exact convention already shipped in
 * vendor/buzz-desktop/src/shared/api/relayMembers.ts: a NIP-43-style
 * aggregate snapshot event (kind 13534) carries one `member`/`p` tag per
 * relay member, and admin actions are separate signed events (kind 9030 add,
 * 9031 remove, 9032 change-role) that something replays into the next
 * snapshot. Our relay does not run that replay itself (see relay-store.ts —
 * it stores whatever kind it is given, it does not interpret 9030/9031/9032),
 * so on a fresh Dobius relay no snapshot exists yet; every reader here must
 * treat "no snapshot" as "no members recorded", not as an error.
 */

export const RELAY_MEMBERSHIP_SNAPSHOT_KIND = 13534
export const RELAY_MEMBER_ADD_KIND = 9030
export const RELAY_MEMBER_REMOVE_KIND = 9031
export const RELAY_MEMBER_ROLE_CHANGE_KIND = 9032

export type RelayMemberRole = 'owner' | 'admin' | 'member'

export type RelayMemberProjection = {
  pubkey: string
  role: RelayMemberRole
  addedBy: string | null
  createdAtIso: string
}

const PUBKEY_HEX_RE = /^[0-9a-f]{64}$/i

function isRelayMemberRole(value: string | undefined): value is RelayMemberRole {
  return value === 'owner' || value === 'admin' || value === 'member'
}

/**
 * Reads a snapshot event's tags into member rows. Accepts both `member` tags
 * (role in position 2) and bare `p` tags (role in position 3) — the same
 * dual convention `relayMembersFromEvent` in relayMembers.ts reads, so a
 * snapshot produced by either shape parses identically here.
 */
export function relayMembersFromSnapshotTags(tags: readonly string[][], createdAtIso: string): RelayMemberProjection[] {
  const seen = new Set<string>()
  const members: RelayMemberProjection[] = []

  for (const tag of tags) {
    const [name, rawPubkey, maybeRoleOrRelay, maybePTagRole] = tag
    if (name !== 'member' && name !== 'p') {
      continue
    }
    if (!rawPubkey) {
      continue
    }

    const pubkey = rawPubkey.trim().toLowerCase()
    if (!PUBKEY_HEX_RE.test(pubkey) || seen.has(pubkey)) {
      continue
    }
    seen.add(pubkey)

    const rawRole = name === 'member' ? maybeRoleOrRelay : maybePTagRole
    members.push({
      pubkey,
      role: isRelayMemberRole(rawRole) ? rawRole : 'member',
      addedBy: null,
      createdAtIso
    })
  }

  return members
}

/** Tags for a kind 9030/9031/9032 admin action event. `role` is omitted for remove. */
export function buildRelayAdminEventTags(targetPubkey: string, role?: string): string[][] {
  const tags: string[][] = [['p', targetPubkey.trim().toLowerCase()]]
  if (role) {
    tags.push(['role', role])
  }
  return tags
}

/**
 * A fresh Dobius relay has no membership snapshot at all — nothing turns
 * 9030/9031/9032 admin events into one (see this file's top comment). That
 * is not "zero members": a local, single-owner relay's own identity is
 * definitionally its owner from the moment it exists, snapshot or not. Used
 * by `get_my_relay_membership`/`list_relay_members` only when no snapshot
 * has ever been published; once one exists, it is the source of truth and
 * this bootstrap row is not consulted.
 */
export function bootstrapOwnerMember(selfPubkey: string, createdAtIso: string): RelayMemberProjection {
  return { pubkey: selfPubkey.trim().toLowerCase(), role: 'owner', addedBy: null, createdAtIso }
}
