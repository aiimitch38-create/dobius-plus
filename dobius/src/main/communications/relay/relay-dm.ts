/**
 * DM channel provisioning for kind-41010 "open a DM" requests.
 *
 * Upstream Buzz's own Rust relay provisioned DM channels server-side: a
 * client posts a kind-41010 event naming the other participants, and the
 * relay hands back a channel id in the POST /events response so the client
 * can immediately look up the channel's kind-39000 metadata event (see
 * vendor/buzz-desktop/src/shared/api/dobiusCommunications.ts openDobiusDm,
 * lines 412-451). Our relay is a plain NIP-01 store with no such behaviour,
 * so this module reproduces it: derive a deterministic channel id from the
 * participant set, ensure a kind-39000 event names them all, and return the
 * id in the exact `response:{"channel_id":...}` wire format the client parses.
 */

import { schnorr } from '@noble/curves/secp256k1'
import { createHash } from 'node:crypto'
import { computeRelayEventId } from './relay-event'
import type { RelayStore } from './relay-store'
import type { RelayEvent } from './relay-types'

/** The Buzz client's "open a DM" request kind (dobiusCommunications.ts openDobiusDm). */
export const DM_OPEN_KIND = 41010

/** Addressable channel-metadata kind (NIP-01 range 30000-40000, keyed by its "d" tag). */
const DM_CHANNEL_METADATA_KIND = 39000

/**
 * A fixed, deterministic signing identity for relay-authored system events.
 * Not a user secret — it grants no access to anything outside this local
 * event store — and it MUST stay stable across restarts: kind 39000 is
 * addressable by (pubkey, kind, d-tag), so a different pubkey on a later
 * provisioning call would create a second channel row instead of replacing
 * the first (see RelayStore.findReplacementCandidates).
 */
const SYSTEM_SECRET_KEY = createHash('sha256').update('dobius-relay-dm-channel-authority').digest()
const SYSTEM_PUBKEY = Buffer.from(schnorr.getPublicKey(SYSTEM_SECRET_KEY)).toString('hex')

/** The request's author plus every "p" tag, lowercased and deduplicated. */
function dmParticipants(event: RelayEvent): string[] {
  const pubkeys = [event.pubkey, ...event.tags.filter((tag) => tag[0] === 'p').map((tag) => tag[1])]
  return [...new Set(pubkeys.map((pubkey) => pubkey.toLowerCase()))]
}

/**
 * Deterministic, order- and initiator-independent channel id: sha256 of the
 * sorted, deduplicated participant set joined by a comma. The same two
 * people always land on the same id, whichever of them calls open_dm and
 * whatever order their pubkeys arrive in as tags, so re-opening an existing
 * DM resolves to it instead of provisioning a duplicate.
 */
function deriveChannelId(participants: string[]): string {
  return createHash('sha256').update([...participants].sort().join(',')).digest('hex')
}

function signSystemEvent(kind: number, tags: string[][], createdAt: number): RelayEvent {
  const unsigned = { id: '', pubkey: SYSTEM_PUBKEY, created_at: createdAt, kind, tags, content: '', sig: '' }
  const id = computeRelayEventId(unsigned)
  const sig = Buffer.from(schnorr.sign(id, SYSTEM_SECRET_KEY)).toString('hex')
  return { ...unsigned, id, sig }
}

export type DmOpenResult = { ok: boolean; message: string }

/**
 * Handles one kind-41010 request: rejects a degenerate "DM with nobody",
 * otherwise ensures a kind-39000 metadata event names every participant
 * (reusing an already-provisioned channel instead of re-inserting it) and
 * returns the `response:{...}` message the client's openDobiusDm parses.
 *
 * `onChannelCreated` fires only when a NEW metadata event was just written,
 * so the caller can fan it out to live subscribers without also re-notifying
 * them every time someone re-opens an already-provisioned DM.
 */
export function openDmChannel(
  store: RelayStore,
  event: RelayEvent,
  now: number,
  onChannelCreated?: (metadataEvent: RelayEvent) => void
): DmOpenResult {
  const participants = dmParticipants(event)
  if (participants.length < 2) {
    return { ok: false, message: 'invalid: DM open event needs at least one other participant' }
  }

  const channelId = deriveChannelId(participants)
  const alreadyProvisioned = store.query([
    { kinds: [DM_CHANNEL_METADATA_KIND], '#d': [channelId], limit: 1 }
  ])
  if (alreadyProvisioned.length === 0) {
    const tags = [['d', channelId], ...participants.map((pubkey) => ['p', pubkey])]
    const metadataEvent = signSystemEvent(DM_CHANNEL_METADATA_KIND, tags, now)
    store.insert(metadataEvent)
    onChannelCreated?.(metadataEvent)
  }

  return { ok: true, message: `response:${JSON.stringify({ channel_id: channelId })}` }
}
