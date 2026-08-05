// Native port of the DM-channel-list slice of loadRelayChannels() in
// dobiusCommunications.ts. Scope: DM channels only (channel_type === "dm"),
// per plans/PORT-buzz-inbox-SPEC.md's Stage 3 mapping table.
import { getOwnPubkey, publishAsSelf, queryRelay, type RelayEventRecord } from './relay-client'
import { loadProfilesBatch, resolveUserLabel, type RelayProfile } from './profile'

const CHANNEL_METADATA_KIND = 39000
const CHANNEL_MEMBERSHIP_KIND = 39002

export type DmChannel = {
  id: string
  /** Other participants, excluding self. Empty for a channel with no resolvable peer. */
  otherPubkeys: string[]
  lastMessageAt: number | null
}

export type DmChannelWithLabel = DmChannel & {
  /** Resolved display label (name -> nip05 -> raw pubkey), joined for group DMs. */
  label: string
  /** The single other participant's profile, when this is a 1:1 DM. */
  otherProfile: RelayProfile | null
}

function eventTag(event: RelayEventRecord, name: string): string | null {
  return event.tags.find((tag) => tag[0] === name)?.[1] ?? null
}

/** Loads every DM channel the local identity is a member of, newest-first. */
export async function loadDmChannels(): Promise<DmChannel[]> {
  const selfPubkey = await getOwnPubkey()
  const [memberships, metadata] = await Promise.all([
    queryRelay([{ kinds: [39002], '#p': [selfPubkey], limit: 1000 }]),
    queryRelay([{ kinds: [39000], limit: 200 }])
  ])

  const channels: DmChannel[] = []
  for (const event of metadata) {
    const id = eventTag(event, 'd')
    const channelType = eventTag(event, 't') ?? 'stream'
    if (!id || channelType !== 'dm') {continue}

    const membership = memberships.find((candidate) => eventTag(candidate, 'd') === id)
    const participants = (membership?.tags ?? [])
      .filter((tag) => tag[0] === 'p')
      .map((tag) => tag[1])
    const otherPubkeys = participants.filter((pubkey) => pubkey.toLowerCase() !== selfPubkey.toLowerCase())
    channels.push({ id, otherPubkeys, lastMessageAt: null })
  }

  return channels
}

/**
 * Both participants must derive the SAME channel id without coordinating, so it is
 * built from the sorted pubkey pair rather than a random slug (which is what
 * createDobiusChannel uses for named channels).
 */
function dmChannelId(a: string, b: string): string {
  const [first, second] = [a.toLowerCase(), b.toLowerCase()].sort()
  return `dm-${first.slice(0, 16)}-${second.slice(0, 16)}`
}

/**
 * Opens the 1:1 DM with `peerPubkey`, creating it on the relay if it does not exist.
 * Returns the channel id to select. Without this there is no way to start a
 * conversation from an empty inbox — the list only renders channels already on the
 * relay (see loadDmChannels).
 */
export async function openDmWithPeer(peerPubkey: string): Promise<string> {
  const selfPubkey = await getOwnPubkey()
  const peer = peerPubkey.toLowerCase()

  const existing = (await loadDmChannels()).find(
    (channel) =>
      channel.otherPubkeys.length === 1 && channel.otherPubkeys[0].toLowerCase() === peer
  )
  if (existing) {return existing.id}

  const channelId = dmChannelId(selfPubkey, peer)
  await publishAsSelf({
    kind: CHANNEL_METADATA_KIND,
    content: '',
    tags: [
      ['d', channelId],
      ['name', ''],
      ['t', 'dm']
    ]
  })
  await publishAsSelf({
    kind: CHANNEL_MEMBERSHIP_KIND,
    content: '',
    tags: [
      ['d', channelId],
      ['p', selfPubkey, 'owner'],
      ['p', peer, 'member']
    ]
  })
  return channelId
}

/** Resolves display labels/profiles for a batch of DM channels in one pass. */
export async function withResolvedLabels(channels: DmChannel[]): Promise<DmChannelWithLabel[]> {
  const allOtherPubkeys = Array.from(new Set(channels.flatMap((channel) => channel.otherPubkeys)))
  const profiles = await loadProfilesBatch(allOtherPubkeys)

  return channels.map((channel) => {
    if (channel.otherPubkeys.length === 0) {
      return { ...channel, label: 'You', otherProfile: null }
    }
    if (channel.otherPubkeys.length === 1) {
      const pubkey = channel.otherPubkeys[0]
      const profile = profiles.get(pubkey) ?? null
      return { ...channel, label: resolveUserLabel(profile ?? undefined, pubkey), otherProfile: profile }
    }
    // Group DM: comma-join up to 3 labels, "+N more" beyond that.
    const labels = channel.otherPubkeys.map((pubkey) =>
      resolveUserLabel(profiles.get(pubkey), pubkey)
    )
    const visible = labels.slice(0, 3)
    const overflow = labels.length - visible.length
    const label = overflow > 0 ? `${visible.join(', ')}, +${overflow} more` : visible.join(', ')
    return { ...channel, label, otherProfile: null }
  })
}
