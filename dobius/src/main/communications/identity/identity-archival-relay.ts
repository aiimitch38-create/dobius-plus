// NIP-IA-style identity archival, submitted to and read from the local
// Communications relay: `archive_identity` (kind 9035), `unarchive_identity`
// (kind 9036), `list_archived_identities` (latest kind 13535 snapshot), and
// `resolve_oa_owner` (an "owner of agent" claim read off a target's kind:0
// profile). No formal NIP-OA/NIP-IA spec ships with this repo — the wire
// shapes below are this module's own reasonable reading of the Buzz client
// contract (see vendor/buzz-desktop/src/shared/api/tauriIdentityArchive.ts),
// flagged explicitly in the build report for whoever owns the relay side to
// confirm against the real server they're porting from.
import {
  getParticipantPublicIdentity,
  signParticipantEvent
} from '../participant-identity-store'
import { verifyRelayEvent } from '../relay/relay-event'
import { queryRelayEvents, submitRelayEvent } from './relay-http-client'

const KIND_IDENTITY_ARCHIVE_REQUEST = 9035
const KIND_IDENTITY_UNARCHIVE_REQUEST = 9036
const KIND_ARCHIVED_IDENTITIES_SNAPSHOT = 13535
const KIND_METADATA = 0

const HEX_64 = /^[0-9a-f]{64}$/

export type OwnerOfAgent = { owner: string; isMe: boolean }

export type ArchivedIdentitiesSnapshot = { archived: string[] }

export type IdentityArchiveRequest = {
  targetPubkey: string
  content?: string
  reason?: string
  replacedBy?: string
}

export type IdentityUnarchiveRequest = {
  targetPubkey: string
  content?: string
  reason?: string
}

/**
 * Resolves a target's NIP-OA owner from its live kind:0 profile event's
 * `auth` tag (`["auth", "<owner_pubkey_hex>"]`). Returns null when the
 * target has no profile event or no valid `auth` tag — never throws for
 * "not found", only for a genuine relay/network failure.
 */
export async function resolveOaOwner(targetPubkey: string): Promise<OwnerOfAgent | null> {
  if (!HEX_64.test(targetPubkey)) {
    throw new Error('resolveOaOwner: targetPubkey must be 64 lowercase hex characters')
  }
  const events = await queryRelayEvents([
    { kinds: [KIND_METADATA], authors: [targetPubkey], limit: 1 }
  ])
  const profile = events[0]
  if (!profile) {return null}

  const verification = verifyRelayEvent(profile)
  if (!verification.ok) {return null}

  const authTag = profile.tags.find((tag) => tag[0] === 'auth' && HEX_64.test(tag[1] ?? ''))
  if (!authTag) {return null}

  const owner = authTag[1]
  const self = getParticipantPublicIdentity()
  return { owner, isMe: owner === self.pubkey }
}

async function ownerAuthTag(targetPubkey: string): Promise<string[] | null> {
  const ownerOf = await resolveOaOwner(targetPubkey)
  const self = getParticipantPublicIdentity()
  return ownerOf?.isMe ? ['auth', self.pubkey] : null
}

/** Submits a kind:9035 archive request for `req.targetPubkey`, signed by the participant. */
export async function archiveIdentity(req: IdentityArchiveRequest): Promise<void> {
  if (!HEX_64.test(req.targetPubkey)) {
    throw new Error('archiveIdentity: targetPubkey must be 64 lowercase hex characters')
  }
  const tags: string[][] = [['p', req.targetPubkey]]
  if (req.reason) {tags.push(['reason', req.reason])}
  if (req.replacedBy) {tags.push(['replaced_by', req.replacedBy])}
  const auth = await ownerAuthTag(req.targetPubkey)
  if (auth) {tags.push(auth)}

  const signed = signParticipantEvent({
    kind: KIND_IDENTITY_ARCHIVE_REQUEST,
    content: req.content ?? '',
    tags
  })
  await submitRelayEvent(signed)
}

/** Submits a kind:9036 unarchive request for `req.targetPubkey`, signed by the participant. */
export async function unarchiveIdentity(req: IdentityUnarchiveRequest): Promise<void> {
  if (!HEX_64.test(req.targetPubkey)) {
    throw new Error('unarchiveIdentity: targetPubkey must be 64 lowercase hex characters')
  }
  const tags: string[][] = [['p', req.targetPubkey]]
  if (req.reason) {tags.push(['reason', req.reason])}
  const auth = await ownerAuthTag(req.targetPubkey)
  if (auth) {tags.push(auth)}

  const signed = signParticipantEvent({
    kind: KIND_IDENTITY_UNARCHIVE_REQUEST,
    content: req.content ?? '',
    tags
  })
  await submitRelayEvent(signed)
}

/**
 * Reads the relay's latest kind:13535 snapshot and collects every `p` tag
 * value as an archived pubkey (NIP-51-style list-of-pubkeys convention).
 */
export async function listArchivedIdentities(): Promise<ArchivedIdentitiesSnapshot> {
  const events = await queryRelayEvents([{ kinds: [KIND_ARCHIVED_IDENTITIES_SNAPSHOT], limit: 1 }])
  const snapshot = events[0]
  if (!snapshot) {return { archived: [] }}

  const verification = verifyRelayEvent(snapshot)
  if (!verification.ok) {return { archived: [] }}

  const archived = snapshot.tags
    .filter((tag) => tag[0] === 'p' && HEX_64.test(tag[1] ?? ''))
    .map((tag) => tag[1])
  return { archived }
}
